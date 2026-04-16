from __future__ import annotations

import pytest

from feishu_auth_kit.models import AppInfo
from feishu_auth_kit.owner_policy import (
    OwnerPolicyError,
    OwnerPolicyMode,
    assert_owner_policy,
    check_owner_policy,
)


class FakeClient:
    def __init__(self, app_info: AppInfo) -> None:
        self.app_info = app_info
        self.calls: list[str] = []

    def get_app_info(self, app_id: str = "me") -> AppInfo:
        self.calls.append(app_id)
        return self.app_info


def test_owner_policy_allows_effective_owner_from_existing_app_info() -> None:
    app_info = AppInfo(
        app_id="cli_a1b2",
        owner_open_id="ou_owner",
        effective_owner_open_id="ou_owner",
    )

    result = check_owner_policy(app_info, current_user_open_id="ou_owner")

    assert result.allowed is True
    assert result.owner_open_id == "ou_owner"
    assert result.current_user_open_id == "ou_owner"
    assert result.mode == OwnerPolicyMode.STRICT_OWNER


def test_owner_policy_rejects_non_owner_in_strict_mode() -> None:
    app_info = AppInfo(
        app_id="cli_a1b2",
        owner_open_id="ou_owner",
        effective_owner_open_id="ou_owner",
    )

    result = check_owner_policy(app_info, current_user_open_id="ou_other")

    assert result.allowed is False
    assert "ou_owner" in result.reason
    with pytest.raises(OwnerPolicyError):
        assert_owner_policy(app_info, current_user_open_id="ou_other")


def test_owner_policy_can_fetch_app_info_from_client_without_duplicate_http_logic() -> None:
    client = FakeClient(
        AppInfo(
            app_id="cli_a1b2",
            creator_id="ou_creator",
            effective_owner_open_id="ou_creator",
        )
    )

    result = check_owner_policy(
        client,
        current_user_open_id="ou_other",
        mode=OwnerPolicyMode.PERMISSIVE_IF_UNKNOWN,
        app_id="me",
    )

    assert client.calls == ["me"]
    assert result.allowed is False
    assert result.owner_open_id == "ou_creator"


def test_owner_policy_permissive_mode_allows_missing_owner_metadata() -> None:
    app_info = AppInfo(app_id="cli_a1b2")

    result = check_owner_policy(
        app_info,
        current_user_open_id="ou_user",
        mode=OwnerPolicyMode.PERMISSIVE_IF_UNKNOWN,
    )

    assert result.allowed is True
    assert "metadata unavailable" in result.reason

