from __future__ import annotations

from feishu_auth_kit.models import DeviceToken
from feishu_auth_kit.token_store import FileTokenStore, StoredUserToken


def test_file_token_store_saves_loads_status_and_removes_user_token(tmp_path) -> None:
    store = FileTokenStore(tmp_path / "tokens.json")
    token = StoredUserToken(
        app_id="cli_a1b2",
        user_open_id="ou_user",
        access_token="access-token",
        refresh_token="refresh-token",
        expires_at=1_800,
        refresh_expires_at=3_600,
        scope="im:message:readonly offline_access",
    )

    store.save(token)

    loaded = store.load("cli_a1b2", "ou_user")
    status = store.status("cli_a1b2", "ou_user")
    assert loaded == token
    assert status.exists is True
    assert status.app_id == "cli_a1b2"
    assert status.user_open_id == "ou_user"
    assert status.scope == "im:message:readonly offline_access"
    assert status.storage_path == tmp_path / "tokens.json"

    assert store.remove("cli_a1b2", "ou_user") is True
    assert store.load("cli_a1b2", "ou_user") is None
    assert store.status("cli_a1b2", "ou_user").exists is False
    assert store.remove("cli_a1b2", "ou_user") is False


def test_file_token_store_can_save_device_token_with_relative_expiry(tmp_path) -> None:
    store = FileTokenStore(tmp_path / "tokens.json")
    device_token = DeviceToken(
        access_token="access-token",
        refresh_token="refresh-token",
        expires_in=600,
        refresh_expires_in=1_200,
        scope="offline_access",
    )

    stored = store.save_device_token(
        "cli_a1b2",
        "ou_user",
        device_token,
        now=1_000,
    )

    assert stored.expires_at == 1_600
    assert stored.refresh_expires_at == 2_200
    assert store.load("cli_a1b2", "ou_user") == stored

