from __future__ import annotations

import json

from feishu_auth_kit import cli
from feishu_auth_kit.app_registration import (
    AppRegistrationBeginResult,
    AppRegistrationPollResult,
    AppRegistrationResult,
)


def test_setup_output_contains_manual_open_platform_steps(capsys) -> None:
    exit_code = cli.main(["setup"])
    captured = capsys.readouterr()

    assert exit_code == 0
    assert "Feishu / Lark app setup guide" in captured.out
    assert "official scan-to-create app registration flow" in captured.out
    assert "Open Platform approval" in captured.out
    assert "application:application:self_manage" in captured.out
    assert "offline_access" in captured.out


def test_doctor_subcommand_accepts_credentials_after_command() -> None:
    parser = cli.build_parser()

    args = parser.parse_args(["doctor", "--app-id", "cli_xxx", "--app-secret", "secret"])

    assert args.command == "doctor"
    assert args.app_id == "cli_xxx"
    assert args.app_secret == "secret"


def test_runtime_permission_card_command_emits_json_and_persists_continuation(
    tmp_path, capsys
) -> None:
    continuation_path = tmp_path / "continuations.json"

    exit_code = cli.main(
        [
            "runtime",
            "permission-card",
            "--app-id",
            "cli_xxx",
            "--scope",
            "offline_access",
            "--permission-url",
            "https://open.feishu.cn/app/cli_xxx/auth?q=offline_access",
            "--operation-id",
            "op-123",
            "--continuation-store-path",
            str(continuation_path),
        ]
    )
    captured = capsys.readouterr()
    payload = json.loads(captured.out)

    assert exit_code == 0
    assert payload["type"] == "permission_missing"
    assert payload["operation_id"] == "op-123"
    stored = json.loads(continuation_path.read_text(encoding="utf-8"))
    assert "op-123" in stored["continuations"]


def test_tokens_commands_can_save_and_report_status(tmp_path, capsys) -> None:
    token_path = tmp_path / "tokens.json"

    save_exit_code = cli.main(
        [
            "tokens",
            "save",
            "--app-id",
            "cli_xxx",
            "--user-open-id",
            "ou_user",
            "--access-token",
            "access-token",
            "--scope",
            "offline_access",
            "--token-store-path",
            str(token_path),
        ]
    )
    _ = capsys.readouterr()
    status_exit_code = cli.main(
        [
            "tokens",
            "status",
            "--app-id",
            "cli_xxx",
            "--user-open-id",
            "ou_user",
            "--token-store-path",
            str(token_path),
            "--json",
        ]
    )
    captured = capsys.readouterr()
    payload = json.loads(captured.out)

    assert save_exit_code == 0
    assert status_exit_code == 0
    assert payload["exists"] is True
    assert payload["scope"] == "offline_access"


def test_orchestration_plan_command_emits_scope_diff(capsys) -> None:
    exit_code = cli.main(
        [
            "orchestration",
            "plan",
            "--requested-scope",
            "offline_access,im:message:readonly",
            "--app-scope",
            "offline_access,im:message:readonly",
            "--user-scope",
            "offline_access",
        ]
    )
    captured = capsys.readouterr()
    payload = json.loads(captured.out)

    assert exit_code == 0
    assert payload["missing_user_scopes"] == ["im:message:readonly"]
    assert payload["already_granted_scopes"] == ["offline_access"]


def test_orchestration_route_command_reuses_pending_flow_and_persists_state(
    tmp_path,
    capsys,
) -> None:
    continuation_path = tmp_path / "continuations.json"
    pending_path = tmp_path / "pending.json"
    args = [
        "orchestration",
        "route",
        "--app-id",
        "cli_xxx",
        "--error-kind",
        "app_scope_missing",
        "--required-scope",
        "offline_access",
        "--user-open-id",
        "ou_user",
        "--flow-key",
        "flow-1",
        "--permission-url",
        "https://open.feishu.cn/app/cli_xxx/auth?q=offline_access",
        "--continuation-store-path",
        str(continuation_path),
        "--pending-flow-store-path",
        str(pending_path),
    ]

    first_exit_code = cli.main(args)
    first_output = json.loads(capsys.readouterr().out)
    second_exit_code = cli.main(
        [
            *args[: args.index("--required-scope") + 2],
            "--required-scope",
            "im:message:readonly",
            *args[args.index("--user-open-id") :],
        ]
    )
    second_output = json.loads(capsys.readouterr().out)

    assert first_exit_code == 0
    assert second_exit_code == 0
    assert first_output["flow"]["operation_id"] == second_output["flow"]["operation_id"]
    assert second_output["reused_existing_flow"] is True
    assert second_output["flow"]["required_scopes"] == [
        "offline_access",
        "im:message:readonly",
    ]


def test_orchestration_retry_command_builds_artifact_from_continuation(
    tmp_path,
    capsys,
) -> None:
    continuation_path = tmp_path / "continuations.json"
    route_exit_code = cli.main(
        [
            "orchestration",
            "route",
            "--app-id",
            "cli_xxx",
            "--error-kind",
            "app_scope_missing",
            "--required-scope",
            "offline_access",
            "--user-open-id",
            "ou_user",
            "--flow-key",
            "flow-1",
            "--operation-id",
            "op-123",
            "--permission-url",
            "https://open.feishu.cn/app/cli_xxx/auth?q=offline_access",
            "--continuation-store-path",
            str(continuation_path),
            "--pending-flow-store-path",
            str(tmp_path / "pending.json"),
        ]
    )
    _ = capsys.readouterr()
    retry_exit_code = cli.main(
        [
            "orchestration",
            "retry",
            "--operation-id",
            "op-123",
            "--text",
            "请继续之前的操作",
            "--continuation-store-path",
            str(continuation_path),
        ]
    )
    payload = json.loads(capsys.readouterr().out)

    assert route_exit_code == 0
    assert retry_exit_code == 0
    assert payload["kind"] == "synthetic_retry"
    assert payload["operation_id"] == "op-123"
    assert payload["user_open_id"] == "ou_user"


def test_register_scan_create_no_poll_emits_structured_payload(monkeypatch, capsys) -> None:
    class FakeRegistrationClient:
        def __init__(self, *args, **kwargs) -> None:
            self.args = args
            self.kwargs = kwargs

        def init(self) -> None:
            return None

        def begin(self) -> AppRegistrationBeginResult:
            return AppRegistrationBeginResult(
                device_code="dev-123",
                qr_url="https://accounts.feishu.cn/verify?device_code=dev-123&from=oc_onboard&tp=ob_cli_app",
                user_code="ABCD-EFGH",
                interval=5,
                expires_in=600,
                verification_uri="https://accounts.feishu.cn/verify",
                verification_uri_complete="https://accounts.feishu.cn/verify?device_code=dev-123",
            )

    monkeypatch.setattr(cli, "AppRegistrationClient", FakeRegistrationClient)

    exit_code = cli.main(["register", "scan-create", "--no-poll", "--json"])
    payload = json.loads(capsys.readouterr().out)

    assert exit_code == 0
    assert payload["status"] == "authorization_required"
    assert payload["device_code"] == "dev-123"
    assert payload["qr_url"].startswith("https://accounts.feishu.cn/verify")
    assert payload["interval"] == 5
    assert payload["expires_in"] == 600


def test_register_poll_command_emits_success_payload(monkeypatch, capsys) -> None:
    class FakeRegistrationClient:
        def __init__(self, *args, **kwargs) -> None:
            self.args = args
            self.kwargs = kwargs

        def poll(
            self,
            device_code: str,
            *,
            interval: int,
            expires_in: int,
            tp: str,
            poll_timeout: int | None = None,
        ) -> AppRegistrationPollResult:
            assert device_code == "dev-123"
            assert interval == 5
            assert expires_in == 600
            assert tp == "ob_app"
            assert poll_timeout == 30
            return AppRegistrationPollResult(
                status="success",
                result=AppRegistrationResult(
                    app_id="cli_new",
                    app_secret="secret-new",
                    domain="feishu",
                    open_id="ou_owner",
                ),
            )

    monkeypatch.setattr(cli, "AppRegistrationClient", FakeRegistrationClient)

    exit_code = cli.main(
        [
            "register",
            "poll",
            "--device-code",
            "dev-123",
            "--interval",
            "5",
            "--expires-in",
            "600",
            "--poll-timeout",
            "30",
            "--json",
        ]
    )
    payload = json.loads(capsys.readouterr().out)

    assert exit_code == 0
    assert payload["status"] == "success"
    assert payload["app_id"] == "cli_new"
    assert payload["app_secret"] == "secret-new"
    assert payload["domain"] == "feishu"
