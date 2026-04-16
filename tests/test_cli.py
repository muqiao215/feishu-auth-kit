from __future__ import annotations

from feishu_auth_kit import cli


def test_setup_output_contains_manual_open_platform_steps(capsys) -> None:
    exit_code = cli.main(["setup"])
    captured = capsys.readouterr()

    assert exit_code == 0
    assert "Feishu / Lark app setup guide" in captured.out
    assert "cannot create the app for you" in captured.out
    assert "Open Platform" in captured.out
    assert "application:application:self_manage" in captured.out
    assert "offline_access" in captured.out


def test_doctor_subcommand_accepts_credentials_after_command() -> None:
    parser = cli.build_parser()

    args = parser.parse_args(["doctor", "--app-id", "cli_xxx", "--app-secret", "secret"])

    assert args.command == "doctor"
    assert args.app_id == "cli_xxx"
    assert args.app_secret == "secret"
