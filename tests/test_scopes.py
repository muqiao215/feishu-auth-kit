from __future__ import annotations

from feishu_auth_kit.scopes import (
    CORE_APP_SCOPES,
    batch_scopes,
    filter_sensitive_scopes,
    summarize_scope_batches,
)


def test_filter_sensitive_scopes_removes_high_risk_items() -> None:
    scopes = [
        "im:message:readonly",
        "im:message.send_as_user",
        "space:document:delete",
        "offline_access",
    ]

    filtered = filter_sensitive_scopes(scopes)

    assert filtered == ["im:message:readonly", "offline_access"]


def test_batch_scopes_splits_in_stable_chunks() -> None:
    scopes = [f"scope:{index}" for index in range(7)]

    batches = batch_scopes(scopes, batch_size=3)

    assert batches == [
        ["scope:0", "scope:1", "scope:2"],
        ["scope:3", "scope:4", "scope:5"],
        ["scope:6"],
    ]


def test_summarize_scope_batches_reports_counts() -> None:
    summary = summarize_scope_batches([["a", "b"], ["c"]])

    assert summary == ["Batch 1: 2 scopes", "Batch 2: 1 scopes"]
    assert "application:application:self_manage" in CORE_APP_SCOPES
