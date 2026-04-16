from __future__ import annotations

from feishu_auth_kit.models import DeviceAuthorization
from feishu_auth_kit.runtime_cards import (
    CardAction,
    ContinuationState,
    FileContinuationStore,
    build_device_flow_card,
    build_permission_missing_card,
    process_card_action,
)


def test_permission_missing_card_contains_action_payload_and_permission_url() -> None:
    card = build_permission_missing_card(
        app_id="cli_a1b2",
        operation_id="op-123",
        missing_scopes=["application:application:self_manage"],
        permission_url="https://open.feishu.cn/app/cli_a1b2/auth?q=x",
        user_open_id="ou_user",
    )

    body = card.to_dict()
    assert body["type"] == "permission_missing"
    assert body["operation_id"] == "op-123"
    assert body["actions"][0]["action"] == "permissions_granted_continue"
    assert body["actions"][0]["payload"]["operation_id"] == "op-123"
    assert body["links"][0]["url"] == "https://open.feishu.cn/app/cli_a1b2/auth?q=x"


def test_device_flow_card_contains_authorization_url_user_code_and_continue_action() -> None:
    authorization = DeviceAuthorization(
        device_code="device-123",
        user_code="ABCD-EFGH",
        verification_uri="https://example.test/verify",
        verification_uri_complete="https://example.test/verify?code=ABCD-EFGH",
        expires_in=600,
        interval=5,
    )

    card = build_device_flow_card(
        app_id="cli_a1b2",
        operation_id="op-456",
        authorization=authorization,
    )

    body = card.to_dict()
    assert body["type"] == "device_flow_authorization"
    assert body["fields"]["user_code"] == "ABCD-EFGH"
    assert body["fields"]["device_code"] == "device-123"
    assert body["actions"][0]["action"] == "device_authorized_continue"
    assert body["actions"][0]["payload"]["operation_id"] == "op-456"


def test_file_continuation_store_and_action_processing_round_trip(tmp_path) -> None:
    store = FileContinuationStore(tmp_path / "continuations.json")
    state = ContinuationState(
        operation_id="op-123",
        app_id="cli_a1b2",
        kind="permission_missing",
        status="waiting",
        payload={"missing_scopes": ["offline_access"]},
    )
    store.save(state)

    loaded = store.load("op-123")
    result = process_card_action(
        CardAction(
            action="permissions_granted_continue",
            payload={"operation_id": "op-123", "actor_open_id": "ou_user"},
        ),
        store,
    )

    assert loaded == state
    assert result.operation_id == "op-123"
    assert result.status == "confirmed"
    assert result.payload["actor_open_id"] == "ou_user"
    assert store.load("op-123").status == "confirmed"

