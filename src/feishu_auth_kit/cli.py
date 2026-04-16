from __future__ import annotations

import argparse
import os
from collections.abc import Iterable

from .client import FeishuApiError, FeishuAuthClient
from .device_flow import DeviceFlowClient, DeviceFlowError
from .scopes import (
    batch_scopes,
    filter_sensitive_scopes,
    missing_core_scopes,
    summarize_scope_batches,
)


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
        return 1

    print(f"App info: OK ({app_info.app_id})")
    if app_info.name:
        print(f"App name: {app_info.name}")
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
            flow.poll_for_token(
                auth.device_code,
                interval=auth.interval,
                expires_in=auth.expires_in,
            )
        except DeviceFlowError as exc:
            print(f"Batch {index} failed: {exc}")
            return 1
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
    login_parser.set_defaults(func=cmd_login)

    batch_parser = subparsers.add_parser(
        "batch-auth",
        parents=[common],
        help="Split safe app user scopes into batches and authorize one batch at a time.",
    )
    batch_parser.add_argument("--batch-size", type=int, default=100)
    batch_parser.add_argument("--no-poll", action="store_true")
    batch_parser.set_defaults(func=cmd_batch_auth)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)
