from __future__ import annotations

import argparse
import json
import os
from collections.abc import Iterable

from .claude_adapter import (
    build_claude_device_flow_payload,
    build_claude_permission_payload,
)
from .client import FeishuApiError, FeishuAuthClient
from .device_flow import DeviceFlowClient, DeviceFlowError
from .models import DeviceAuthorization
from .owner_policy import OwnerPolicyMode, check_owner_policy
from .runtime_cards import (
    CardAction,
    ContinuationState,
    FileContinuationStore,
    build_device_flow_card,
    build_permission_missing_card,
    new_operation_id,
    process_card_action,
)
from .scopes import (
    batch_scopes,
    filter_sensitive_scopes,
    missing_core_scopes,
    summarize_scope_batches,
)
from .token_store import FileTokenStore, StoredUserToken


def format_setup_guide(brand: str = "feishu") -> str:
    platform = "open.larksuite.com" if brand == "lark" else "open.feishu.cn"
    return "\n".join(
        [
            "Feishu / Lark app setup guide",
            "",
            "This kit cannot create the app for you or bypass Open Platform review.",
            "Use it after you have a self-built app and valid credentials.",
            "",
            "Zero-start checklist:",
            f"1. Open {platform} and create a self-built app.",
            "2. Copy App ID and App Secret from the credentials page.",
            "3. Enable core permissions:",
            "   - application:application:self_manage",
            "   - offline_access",
            "4. Add the user or tenant scopes your downstream tool actually needs.",
            "5. Publish or release the app according to Feishu/Lark policy.",
            "6. Run `feishu-auth-kit doctor --app-id ... --app-secret ...`.",
            "",
            "This repository guides setup and automates validation and OAuth.",
        ]
    )


def _split_csv(items: Iterable[str] | None) -> list[str]:
    scopes: list[str] = []
    for item in items or []:
        scopes.extend(part.strip() for part in item.split(","))
    return [scope for scope in scopes if scope]


def _credentials_from_args(args: argparse.Namespace) -> tuple[str | None, str | None]:
    app_id = args.app_id or os.getenv("FEISHU_APP_ID") or os.getenv("LARK_APP_ID")
    app_secret = (
        args.app_secret or os.getenv("FEISHU_APP_SECRET") or os.getenv("LARK_APP_SECRET")
    )
    return app_id, app_secret


def _default_brand() -> str:
    return os.getenv("FEISHU_BRAND") or os.getenv("LARK_BRAND") or "feishu"


def _require_client(args: argparse.Namespace) -> FeishuAuthClient:
    app_id, app_secret = _credentials_from_args(args)
    if not app_id or not app_secret:
        raise SystemExit("Missing app credentials. Pass --app-id/--app-secret or set env vars.")
    return FeishuAuthClient(app_id, app_secret, brand=args.brand)


def _resolve_login_scopes(args: argparse.Namespace, client: FeishuAuthClient) -> list[str]:
    explicit = _split_csv(args.scope)
    if explicit:
        return explicit
    if getattr(args, "all_app_user_scopes", False):
        return client.get_granted_scopes(token_type="user")
    return client.get_granted_scopes(token_type="user")


def _print_scope_block(title: str, scopes: list[str]) -> None:
    print(f"{title}: {len(scopes)}")
    for scope in scopes:
        print(f"  - {scope}")


def _json_dump(payload: object) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))


def _token_store_from_args(args: argparse.Namespace) -> FileTokenStore:
    return FileTokenStore(getattr(args, "token_store_path", None))


def _continuation_store_from_args(args: argparse.Namespace) -> FileContinuationStore:
    return FileContinuationStore(getattr(args, "continuation_store_path", None))


def cmd_setup(args: argparse.Namespace) -> int:
    print(format_setup_guide(args.brand))
    return 0


def cmd_doctor(args: argparse.Namespace) -> int:
    client = _require_client(args)
    exit_code = 0
    print("Doctor report")
    print(f"Brand: {args.brand}")
    print(f"App ID: {client.app_id}")
    try:
        tenant_token = client.get_tenant_access_token()
        print("Tenant token: OK")
        print(f"Tenant token TTL: {tenant_token.expire or 'unknown'}")
    except FeishuApiError as exc:
        print(f"Tenant token: FAILED ({exc})")
        return 1

    try:
        app_info = client.get_app_info(args.target_app_id)
    except FeishuApiError as exc:
        print(f"App info: FAILED ({exc})")
        permission_url = client.build_permission_url(
            client.app_id,
            scopes=["application:application:self_manage"],
        )
        print(f"Grant application self-management: {permission_url}")
        return 1

    print(f"App info: OK ({app_info.app_id})")
    if app_info.name:
        print(f"App name: {app_info.name}")
    if app_info.effective_owner_open_id:
        print(f"App owner open_id: {app_info.effective_owner_open_id}")
    tenant_scopes = client.get_granted_scopes(token_type="tenant", app_info=app_info)
    user_scopes = client.get_granted_scopes(token_type="user", app_info=app_info)
    all_scopes = client.get_granted_scopes(app_info=app_info)
    _print_scope_block("Tenant scopes", tenant_scopes)
    _print_scope_block("User scopes", user_scopes)

    missing = missing_core_scopes(all_scopes)
    if missing:
        exit_code = 1
        print("Missing core permissions:")
        for scope in missing:
            token_type = "user" if scope == "offline_access" else "tenant"
            url = client.build_permission_url(
                app_info.app_id or client.app_id,
                scopes=[scope],
                token_type=token_type,
            )
            print(f"  - {scope}")
            print(f"    {url}")
    else:
        print("Missing core permissions: none")
    return exit_code


def cmd_scopes(args: argparse.Namespace) -> int:
    client = _require_client(args)
    scopes = client.get_granted_scopes(token_type=args.token_type or None)
    print(f"Granted scopes: {len(scopes)}")
    for scope in scopes:
        print(scope)
    return 0


def cmd_login(args: argparse.Namespace) -> int:
    client = _require_client(args)
    scopes = _resolve_login_scopes(args, client)
    if not scopes:
        print("No scopes available for device flow.")
        return 1
    flow = DeviceFlowClient(client.app_id, client.app_secret, brand=args.brand)
    auth = flow.request_authorization(scopes)
    print(f"Verification URL: {auth.verification_uri}")
    print(f"Verification URL (complete): {auth.verification_uri_complete}")
    print(f"User code: {auth.user_code}")
    print(f"Expires in: {auth.expires_in}s")
    print(f"Poll interval: {auth.interval}s")
    print(f"Requested scopes: {' '.join(scopes)}")
    if args.no_poll:
        return 0
    try:
        token = flow.poll_for_token(
            auth.device_code,
            interval=auth.interval,
            expires_in=auth.expires_in,
        )
    except DeviceFlowError as exc:
        print(f"Device flow polling failed: {exc}")
        return 1
    print("Device flow completed.")
    print(f"Access token acquired: {'yes' if token.access_token else 'no'}")
    print(f"Granted scope: {token.scope or '(not returned)'}")
    save_user_open_id = getattr(args, "save_user_open_id", None)
    if save_user_open_id:
        stored = _token_store_from_args(args).save_device_token(
            client.app_id,
            save_user_open_id,
            token,
        )
        print(f"Stored token for {stored.user_open_id} at {_token_store_from_args(args).path}")
    return 0


def cmd_batch_auth(args: argparse.Namespace) -> int:
    client = _require_client(args)
    user_scopes = client.get_granted_scopes(token_type="user")
    safe_scopes = filter_sensitive_scopes(user_scopes)
    batches = batch_scopes(safe_scopes, batch_size=args.batch_size)
    if not batches:
        print("No user scopes available for batch authorization.")
        return 1
    for line in summarize_scope_batches(batches):
        print(line)

    flow = DeviceFlowClient(client.app_id, client.app_secret, brand=args.brand)
    for index, batch in enumerate(batches, start=1):
        print(f"Starting batch {index}/{len(batches)}")
        print("Scopes:")
        for scope in batch:
            print(f"  - {scope}")
        auth = flow.request_authorization(batch)
        print(f"Open: {auth.verification_uri_complete}")
        print(f"User code: {auth.user_code}")
        if args.no_poll:
            print("Stopping after link generation because --no-poll was used.")
            return 0
        try:
            token = flow.poll_for_token(
                auth.device_code,
                interval=auth.interval,
                expires_in=auth.expires_in,
            )
        except DeviceFlowError as exc:
            print(f"Batch {index} failed: {exc}")
            return 1
        if args.save_user_open_id:
            _token_store_from_args(args).save_device_token(
                client.app_id,
                args.save_user_open_id,
                token,
            )
    return 0


def cmd_tokens_status(args: argparse.Namespace) -> int:
    status = _token_store_from_args(args).status(args.app_id, args.user_open_id)
    if args.json:
        _json_dump(
            {
                "app_id": status.app_id,
                "user_open_id": status.user_open_id,
                "exists": status.exists,
                "scope": status.scope,
                "expires_at": status.expires_at,
                "refresh_expires_at": status.refresh_expires_at,
                "storage_path": str(status.storage_path),
            }
        )
    else:
        print(f"Exists: {'yes' if status.exists else 'no'}")
        print(f"Storage path: {status.storage_path}")
        if status.exists:
            print(f"Scope: {status.scope or '(unknown)'}")
            print(f"Expires at: {status.expires_at or 'unknown'}")
    return 0


def cmd_tokens_show(args: argparse.Namespace) -> int:
    token = _token_store_from_args(args).load(args.app_id, args.user_open_id)
    if not token:
        print("Token not found.")
        return 1
    _json_dump(
        {
            "app_id": token.app_id,
            "user_open_id": token.user_open_id,
            "access_token": token.access_token,
            "refresh_token": token.refresh_token,
            "expires_at": token.expires_at,
            "refresh_expires_at": token.refresh_expires_at,
            "scope": token.scope,
        }
    )
    return 0


def cmd_tokens_save(args: argparse.Namespace) -> int:
    token = StoredUserToken(
        app_id=args.app_id,
        user_open_id=args.user_open_id,
        access_token=args.access_token,
        refresh_token=args.refresh_token,
        expires_at=args.expires_at,
        refresh_expires_at=args.refresh_expires_at,
        scope=args.scope,
    )
    store = _token_store_from_args(args)
    store.save(token)
    print(f"Saved token to {store.path}")
    return 0


def cmd_tokens_remove(args: argparse.Namespace) -> int:
    removed = _token_store_from_args(args).remove(args.app_id, args.user_open_id)
    print("Removed." if removed else "Token not found.")
    return 0 if removed else 1


def cmd_owner_check(args: argparse.Namespace) -> int:
    client = _require_client(args)
    mode = OwnerPolicyMode(args.mode)
    result = check_owner_policy(
        client,
        current_user_open_id=args.current_user_open_id,
        mode=mode,
        app_id=args.target_app_id,
    )
    if args.json:
        _json_dump(
            {
                "allowed": result.allowed,
                "mode": result.mode.value,
                "owner_open_id": result.owner_open_id,
                "current_user_open_id": result.current_user_open_id,
                "reason": result.reason,
                "app_id": result.app_info.app_id,
            }
        )
    else:
        print(f"Allowed: {'yes' if result.allowed else 'no'}")
        print(f"Mode: {result.mode.value}")
        print(f"Owner open_id: {result.owner_open_id or '(unknown)'}")
        print(f"Reason: {result.reason}")
    return 0 if result.allowed else 1


def _save_card_state(
    args: argparse.Namespace,
    *,
    operation_id: str,
    kind: str,
    payload: dict[str, object],
) -> None:
    _continuation_store_from_args(args).save(
        ContinuationState(
            operation_id=operation_id,
            app_id=args.app_id,
            kind=kind,
            status="waiting",
            payload=payload,
        )
    )


def cmd_runtime_permission_card(args: argparse.Namespace) -> int:
    operation_id = args.operation_id or new_operation_id()
    missing_scopes = _split_csv(args.scope)
    card = build_permission_missing_card(
        app_id=args.app_id,
        operation_id=operation_id,
        missing_scopes=missing_scopes,
        permission_url=args.permission_url,
        user_open_id=args.user_open_id,
    )
    _save_card_state(
        args,
        operation_id=operation_id,
        kind="permission_missing",
        payload={
            "missing_scopes": missing_scopes,
            "permission_url": args.permission_url,
            "user_open_id": args.user_open_id,
        },
    )
    _json_dump(card.to_dict())
    return 0


def cmd_runtime_device_card(args: argparse.Namespace) -> int:
    operation_id = args.operation_id or new_operation_id()
    authorization = DeviceAuthorization(
        device_code=args.device_code,
        user_code=args.user_code,
        verification_uri=args.verification_uri,
        verification_uri_complete=args.verification_uri_complete or args.verification_uri,
        expires_in=args.expires_in,
        interval=args.interval,
    )
    card = build_device_flow_card(
        app_id=args.app_id,
        operation_id=operation_id,
        authorization=authorization,
    )
    _save_card_state(
        args,
        operation_id=operation_id,
        kind="device_flow_authorization",
        payload=card.to_dict()["fields"],
    )
    _json_dump(card.to_dict())
    return 0


def cmd_runtime_continue(args: argparse.Namespace) -> int:
    result = process_card_action(
        CardAction(
            action=args.action,
            payload={
                "operation_id": args.operation_id,
                "actor_open_id": args.actor_open_id,
            },
        ),
        _continuation_store_from_args(args),
    )
    _json_dump(
        {
            "operation_id": result.operation_id,
            "app_id": result.app_id,
            "kind": result.kind,
            "status": result.status,
            "payload": result.payload,
        }
    )
    return 0


def cmd_claude_permission_card(args: argparse.Namespace) -> int:
    operation_id = args.operation_id or new_operation_id()
    missing_scopes = _split_csv(args.scope)
    _save_card_state(
        args,
        operation_id=operation_id,
        kind="permission_missing",
        payload={
            "missing_scopes": missing_scopes,
            "permission_url": args.permission_url,
            "user_open_id": args.user_open_id,
        },
    )
    payload = build_claude_permission_payload(
        app_id=args.app_id,
        operation_id=operation_id,
        missing_scopes=missing_scopes,
        permission_url=args.permission_url,
        user_open_id=args.user_open_id,
    )
    _json_dump(payload)
    return 0


def cmd_claude_device_card(args: argparse.Namespace) -> int:
    operation_id = args.operation_id or new_operation_id()
    authorization = DeviceAuthorization(
        device_code=args.device_code,
        user_code=args.user_code,
        verification_uri=args.verification_uri,
        verification_uri_complete=args.verification_uri_complete or args.verification_uri,
        expires_in=args.expires_in,
        interval=args.interval,
    )
    _save_card_state(
        args,
        operation_id=operation_id,
        kind="device_flow_authorization",
        payload={
            "device_code": authorization.device_code,
            "user_code": authorization.user_code,
            "verification_uri": authorization.verification_uri,
            "verification_uri_complete": authorization.verification_uri_complete,
            "expires_in": authorization.expires_in,
            "interval": authorization.interval,
        },
    )
    payload = build_claude_device_flow_payload(
        app_id=args.app_id,
        operation_id=operation_id,
        authorization=authorization,
    )
    _json_dump(payload)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="feishu-auth-kit")
    subparsers = parser.add_subparsers(dest="command", required=True)
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--brand", default=_default_brand(), choices=["feishu", "lark"])
    common.add_argument("--app-id")
    common.add_argument("--app-secret")

    setup_parser = subparsers.add_parser("setup", help="Print zero-start app setup guidance.")
    setup_parser.add_argument("--brand", default=_default_brand(), choices=["feishu", "lark"])
    setup_parser.set_defaults(func=cmd_setup)

    doctor_parser = subparsers.add_parser(
        "doctor",
        parents=[common],
        help="Validate app credentials, token, app info, scopes, and core permissions.",
    )
    doctor_parser.add_argument("--target-app-id", default="me")
    doctor_parser.set_defaults(func=cmd_doctor)

    scopes_parser = subparsers.add_parser(
        "scopes",
        parents=[common],
        help="List granted app scopes.",
    )
    scopes_parser.add_argument("--token-type", choices=["user", "tenant"])
    scopes_parser.set_defaults(func=cmd_scopes)

    login_help = "Run OAuth device flow for explicit scopes or all app user scopes."
    auth_url_parser = subparsers.add_parser("auth-url", parents=[common], help=login_help)
    auth_url_parser.add_argument("--scope", action="append", default=[])
    auth_url_parser.add_argument("--all-app-user-scopes", action="store_true")
    auth_url_parser.add_argument("--no-poll", action="store_true")
    auth_url_parser.set_defaults(func=cmd_login)

    login_parser = subparsers.add_parser("login", parents=[common], help=login_help)
    login_parser.add_argument("--scope", action="append", default=[])
    login_parser.add_argument("--all-app-user-scopes", action="store_true")
    login_parser.add_argument("--no-poll", action="store_true")
    login_parser.add_argument("--save-user-open-id")
    login_parser.add_argument("--token-store-path")
    login_parser.set_defaults(func=cmd_login)

    batch_parser = subparsers.add_parser(
        "batch-auth",
        parents=[common],
        help="Split safe app user scopes into batches and authorize one batch at a time.",
    )
    batch_parser.add_argument("--batch-size", type=int, default=100)
    batch_parser.add_argument("--no-poll", action="store_true")
    batch_parser.add_argument("--save-user-open-id")
    batch_parser.add_argument("--token-store-path")
    batch_parser.set_defaults(func=cmd_batch_auth)

    tokens_parser = subparsers.add_parser(
        "tokens",
        help="Persist, inspect, and remove user tokens from a file-backed store.",
    )
    tokens_subparsers = tokens_parser.add_subparsers(dest="tokens_command", required=True)
    token_common = argparse.ArgumentParser(add_help=False)
    token_common.add_argument("--app-id", required=True)
    token_common.add_argument("--user-open-id", required=True)
    token_common.add_argument("--token-store-path")

    tokens_status_parser = tokens_subparsers.add_parser(
        "status",
        parents=[token_common],
        help="Show token presence and metadata.",
    )
    tokens_status_parser.add_argument("--json", action="store_true")
    tokens_status_parser.set_defaults(func=cmd_tokens_status)

    tokens_show_parser = tokens_subparsers.add_parser(
        "show",
        parents=[token_common],
        help="Load and print a stored token.",
    )
    tokens_show_parser.set_defaults(func=cmd_tokens_show)

    tokens_save_parser = tokens_subparsers.add_parser(
        "save",
        parents=[token_common],
        help="Store a token explicitly.",
    )
    tokens_save_parser.add_argument("--access-token", required=True)
    tokens_save_parser.add_argument("--refresh-token")
    tokens_save_parser.add_argument("--expires-at", type=int)
    tokens_save_parser.add_argument("--refresh-expires-at", type=int)
    tokens_save_parser.add_argument("--scope")
    tokens_save_parser.set_defaults(func=cmd_tokens_save)

    tokens_remove_parser = tokens_subparsers.add_parser(
        "remove",
        parents=[token_common],
        help="Delete a stored token.",
    )
    tokens_remove_parser.set_defaults(func=cmd_tokens_remove)

    owner_parser = subparsers.add_parser(
        "owner-check",
        parents=[common],
        help="Enforce app owner policy against current user open_id.",
    )
    owner_parser.add_argument("--target-app-id", default="me")
    owner_parser.add_argument("--current-user-open-id", required=True)
    owner_parser.add_argument(
        "--mode",
        choices=[mode.value for mode in OwnerPolicyMode],
        default=OwnerPolicyMode.STRICT_OWNER.value,
    )
    owner_parser.add_argument("--json", action="store_true")
    owner_parser.set_defaults(func=cmd_owner_check)

    runtime_parser = subparsers.add_parser(
        "runtime",
        help="Build generic interactive card payloads and process continuation actions.",
    )
    runtime_subparsers = runtime_parser.add_subparsers(dest="runtime_command", required=True)
    runtime_common = argparse.ArgumentParser(add_help=False)
    runtime_common.add_argument("--app-id", required=True)
    runtime_common.add_argument("--operation-id")
    runtime_common.add_argument("--continuation-store-path")

    runtime_permission_parser = runtime_subparsers.add_parser(
        "permission-card",
        parents=[runtime_common],
        help="Emit a generic permission-missing card JSON payload.",
    )
    runtime_permission_parser.add_argument("--scope", action="append", default=[], required=True)
    runtime_permission_parser.add_argument("--permission-url", required=True)
    runtime_permission_parser.add_argument("--user-open-id")
    runtime_permission_parser.set_defaults(func=cmd_runtime_permission_card)

    runtime_device_parser = runtime_subparsers.add_parser(
        "device-card",
        parents=[runtime_common],
        help="Emit a generic device-flow authorization card JSON payload.",
    )
    runtime_device_parser.add_argument("--device-code", required=True)
    runtime_device_parser.add_argument("--user-code", required=True)
    runtime_device_parser.add_argument("--verification-uri", required=True)
    runtime_device_parser.add_argument("--verification-uri-complete")
    runtime_device_parser.add_argument("--expires-in", type=int, required=True)
    runtime_device_parser.add_argument("--interval", type=int, default=5)
    runtime_device_parser.set_defaults(func=cmd_runtime_device_card)

    runtime_continue_parser = runtime_subparsers.add_parser(
        "continue",
        help="Process a user-confirmed continuation action.",
    )
    runtime_continue_parser.add_argument("--operation-id", required=True)
    runtime_continue_parser.add_argument("--action", required=True)
    runtime_continue_parser.add_argument("--actor-open-id")
    runtime_continue_parser.add_argument("--continuation-store-path")
    runtime_continue_parser.set_defaults(func=cmd_runtime_continue)

    claude_parser = subparsers.add_parser(
        "claude",
        help="Emit Claude-facing structured JSON payloads based on generic card abstractions.",
    )
    claude_subparsers = claude_parser.add_subparsers(dest="claude_command", required=True)
    claude_common = argparse.ArgumentParser(add_help=False)
    claude_common.add_argument("--app-id", required=True)
    claude_common.add_argument("--operation-id")
    claude_common.add_argument("--continuation-store-path")

    claude_permission_parser = claude_subparsers.add_parser(
        "permission-card",
        parents=[claude_common],
        help="Emit a Claude-facing permission card wrapper.",
    )
    claude_permission_parser.add_argument("--scope", action="append", default=[], required=True)
    claude_permission_parser.add_argument("--permission-url", required=True)
    claude_permission_parser.add_argument("--user-open-id")
    claude_permission_parser.set_defaults(func=cmd_claude_permission_card)

    claude_device_parser = claude_subparsers.add_parser(
        "device-card",
        parents=[claude_common],
        help="Emit a Claude-facing device-flow card wrapper.",
    )
    claude_device_parser.add_argument("--device-code", required=True)
    claude_device_parser.add_argument("--user-code", required=True)
    claude_device_parser.add_argument("--verification-uri", required=True)
    claude_device_parser.add_argument("--verification-uri-complete")
    claude_device_parser.add_argument("--expires-in", type=int, required=True)
    claude_device_parser.add_argument("--interval", type=int, default=5)
    claude_device_parser.set_defaults(func=cmd_claude_device_card)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)
