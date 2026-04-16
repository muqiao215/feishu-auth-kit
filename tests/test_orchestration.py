from __future__ import annotations

import json

from feishu_auth_kit.models import DeviceAuthorization
from feishu_auth_kit.orchestration import (
    AuthContinuation,
    AuthRequirement,
    FilePendingFlowRegistry,
    build_synthetic_retry_artifact,
    load_auth_continuation,
    plan_scope_authorization,
    route_auth_requirement,
    save_auth_continuation,
    verify_access_token_identity,
)
from feishu_auth_kit.runtime_cards import FileContinuationStore


def test_pending_flow_registry_reuses_operation_id_and_merges_scopes(tmp_path) -> None:
    registry = FilePendingFlowRegistry(tmp_path / "pending.json")
    continuation_store = FileContinuationStore(tmp_path / "continuations.json")

    first = route_auth_requirement(
        app_id="cli_xxx",
        requirement=AuthRequirement(
            error_kind="app_scope_missing",
            required_scopes=["offline_access"],
            user_open_id="ou_user",
            flow_key="flow-1",
        ),
        pending_flows=registry,
        continuation_store=continuation_store,
        permission_url="https://open.feishu.cn/app/cli_xxx/auth?q=offline_access",
    )
    second = route_auth_requirement(
        app_id="cli_xxx",
        requirement=AuthRequirement(
            error_kind="app_scope_missing",
            required_scopes=["im:message:readonly", "offline_access"],
            user_open_id="ou_user",
            flow_key="flow-1",
        ),
        pending_flows=registry,
        continuation_store=continuation_store,
        permission_url="https://open.feishu.cn/app/cli_xxx/auth?q=offline_access",
    )

    assert first.reused_existing_flow is False
    assert second.reused_existing_flow is True
    assert first.flow.operation_id == second.flow.operation_id
    assert second.flow.required_scopes == ["offline_access", "im:message:readonly"]


def test_scope_authorization_plan_reports_missing_unavailable_and_batches() -> None:
    plan = plan_scope_authorization(
        requested_scopes=[
            "offline_access",
            "im:message:readonly",
            "calendar:calendar.event:delete",
            "contact:contact.base:readonly",
        ],
        app_granted_scopes=[
            "offline_access",
            "im:message:readonly",
            "contact:contact.base:readonly",
        ],
        user_granted_scopes=["offline_access"],
        batch_size=1,
    )

    assert plan.already_granted_scopes == ["offline_access"]
    assert plan.missing_user_scopes == [
        "im:message:readonly",
        "contact:contact.base:readonly",
    ]
    assert plan.unavailable_scopes == []
    assert plan.batches == [["im:message:readonly"], ["contact:contact.base:readonly"]]


def test_app_scope_missing_routes_to_permission_card(tmp_path) -> None:
    result = route_auth_requirement(
        app_id="cli_xxx",
        requirement=AuthRequirement(
            error_kind="app_scope_missing",
            required_scopes=["application:application:self_manage"],
            user_open_id="ou_user",
            flow_key="flow-perm",
        ),
        pending_flows=FilePendingFlowRegistry(tmp_path / "pending.json"),
        continuation_store=FileContinuationStore(tmp_path / "continuations.json"),
        permission_url="https://open.feishu.cn/app/cli_xxx/auth?q=application:application:self_manage",
    )

    assert result.decision == "permission_card"
    assert result.card is not None
    assert result.card.to_dict()["type"] == "permission_missing"
    assert result.card.to_dict()["actions"][0]["action"] == "permissions_granted_continue"


def test_user_auth_required_routes_to_device_flow_card(tmp_path) -> None:
    result = route_auth_requirement(
        app_id="cli_xxx",
        requirement=AuthRequirement(
            error_kind="user_auth_required",
            required_scopes=["offline_access", "im:message:readonly"],
            user_open_id="ou_user",
            flow_key="flow-device",
        ),
        pending_flows=FilePendingFlowRegistry(tmp_path / "pending.json"),
        continuation_store=FileContinuationStore(tmp_path / "continuations.json"),
        authorization=DeviceAuthorization(
            device_code="device-123",
            user_code="ABCD-EFGH",
            verification_uri="https://example.test/verify",
            verification_uri_complete="https://example.test/verify?code=ABCD-EFGH",
            expires_in=600,
            interval=5,
        ),
    )

    assert result.decision == "device_flow"
    assert result.card is not None
    assert result.card.to_dict()["type"] == "device_flow_authorization"
    assert result.card.to_dict()["fields"]["user_code"] == "ABCD-EFGH"


def test_synthetic_retry_artifact_contains_host_consumable_fields() -> None:
    artifact = build_synthetic_retry_artifact(
        operation_id="op-123",
        app_id="cli_xxx",
        user_open_id="ou_user",
        text="请继续之前的操作",
        reason="auth_completed",
        metadata={"session_id": "sess-1"},
    )

    assert artifact.schema == "feishu-auth-kit.synthetic-retry.v1"
    assert artifact.kind == "synthetic_retry"
    assert artifact.metadata["session_id"] == "sess-1"


def test_auth_continuation_round_trip(tmp_path) -> None:
    store = FileContinuationStore(tmp_path / "continuations.json")
    continuation = AuthContinuation(
        operation_id="op-123",
        flow_key="flow-123",
        app_id="cli_xxx",
        decision="device_flow",
        user_open_id="ou_user",
        required_scopes=["offline_access", "im:message:readonly"],
        token_type="user",
        scope_need_type="all",
        metadata={"message_id": "msg-1"},
    )

    save_auth_continuation(store, continuation)
    loaded = load_auth_continuation(store, "op-123")

    assert loaded == continuation


def test_verify_access_token_identity_uses_open_id_from_response() -> None:
    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, object]:
            return {"code": 0, "data": {"open_id": "ou_user"}}

    class FakeSession:
        def request(self, method, url, headers=None, timeout=None):  # noqa: ANN001
            assert method == "GET"
            assert url.endswith("/open-apis/authen/v1/user_info")
            assert headers["Authorization"] == "Bearer access-token"
            return FakeResponse()

    result = verify_access_token_identity(
        access_token="access-token",
        expected_open_id="ou_user",
        session=FakeSession(),
    )

    assert result.valid is True
    assert result.actual_open_id == "ou_user"


def test_saved_continuation_file_contains_rich_payload(tmp_path) -> None:
    store = FileContinuationStore(tmp_path / "continuations.json")
    continuation = AuthContinuation(
        operation_id="op-123",
        flow_key="flow-123",
        app_id="cli_xxx",
        decision="permission_card",
        user_open_id="ou_user",
        required_scopes=["application:application:self_manage"],
        token_type="tenant",
        scope_need_type="one",
        metadata={"tool": "calendar"},
    )
    save_auth_continuation(store, continuation)

    payload = json.loads((tmp_path / "continuations.json").read_text(encoding="utf-8"))
    saved = payload["continuations"]["op-123"]["payload"]
    assert saved["flow_key"] == "flow-123"
    assert saved["token_type"] == "tenant"
    assert saved["scope_need_type"] == "one"
    assert saved["metadata"]["tool"] == "calendar"
