from __future__ import annotations

from feishu_auth_kit.native_contract import (
    NativeCardAction,
    NativeContinuationRecord,
    build_retry_artifact_from_request,
    resolve_card_action_to_retry,
    save_native_continuation,
)
from feishu_auth_kit.orchestration import AuthContinuation
from feishu_auth_kit.runtime_cards import FileContinuationStore


def test_native_continuation_resolves_card_action_to_retry_request(tmp_path) -> None:
    store = FileContinuationStore(tmp_path / "continuations.json")
    continuation = NativeContinuationRecord.from_auth_continuation(
        AuthContinuation(
            operation_id="op-123",
            flow_key="flow-123",
            app_id="cli_xxx",
            decision="permission_card",
            user_open_id="ou_user",
            required_scopes=["offline_access"],
            token_type="user",
            scope_need_type="all",
            metadata={"session_id": "sess-1"},
        ),
        retry_text="请继续之前的操作",
    )
    save_native_continuation(store, continuation)

    resolved = resolve_card_action_to_retry(
        NativeCardAction(
            operation_id="op-123",
            action="permissions_granted_continue",
            actor_open_id="ou_actor",
        ),
        store,
    )

    assert resolved.continuation.status == "confirmed"
    assert resolved.retry_request.text == "请继续之前的操作"
    assert resolved.retry_request.actor_open_id == "ou_actor"
    assert resolved.retry_request.user_open_id == "ou_user"
    assert resolved.retry_request.metadata["session_id"] == "sess-1"

    artifact = build_retry_artifact_from_request(resolved.retry_request)
    assert artifact.kind == "synthetic_retry"
    assert artifact.reason == "permissions_granted_continue"
    assert artifact.metadata["actor_open_id"] == "ou_actor"

