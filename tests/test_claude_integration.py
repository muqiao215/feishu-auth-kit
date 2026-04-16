from __future__ import annotations

from feishu_auth_kit.claude_adapter import (
    build_claude_device_flow_payload,
    build_claude_permission_payload,
)
from feishu_auth_kit.models import DeviceAuthorization


def test_claude_permission_payload_wraps_generic_card_without_runtime_coupling() -> None:
    payload = build_claude_permission_payload(
        app_id="cli_a1b2",
        operation_id="op-123",
        missing_scopes=["offline_access"],
        permission_url="https://open.feishu.cn/app/cli_a1b2/auth?q=offline_access",
    )

    assert payload["runtime"] == "claude"
    assert payload["schema"] == "feishu-auth-kit.card.v1"
    assert payload["card"]["type"] == "permission_missing"
    assert "ControlMesh" not in payload["instructions"]
    assert payload["next_step"]["action"] == "permissions_granted_continue"


def test_claude_device_flow_payload_wraps_authorization_card() -> None:
    authorization = DeviceAuthorization(
        device_code="device-123",
        user_code="ABCD-EFGH",
        verification_uri="https://example.test/verify",
        verification_uri_complete="https://example.test/verify?code=ABCD-EFGH",
        expires_in=600,
        interval=5,
    )

    payload = build_claude_device_flow_payload(
        app_id="cli_a1b2",
        operation_id="op-456",
        authorization=authorization,
    )

    assert payload["runtime"] == "claude"
    assert payload["card"]["type"] == "device_flow_authorization"
    assert payload["card"]["fields"]["user_code"] == "ABCD-EFGH"
    assert payload["next_step"]["action"] == "device_authorized_continue"

