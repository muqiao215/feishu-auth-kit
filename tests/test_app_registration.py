from __future__ import annotations

from urllib.parse import parse_qs, urlparse

import pytest

from feishu_auth_kit.app_registration import AppRegistrationClient, AppRegistrationError


class FakeResponse:
    def __init__(self, payload: dict, status_code: int = 200) -> None:
        self._payload = payload
        self.status_code = status_code

    def json(self) -> dict:
        return self._payload

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"http {self.status_code}")


class FakeSession:
    def __init__(self, responses: list[FakeResponse]) -> None:
        self.responses = responses
        self.calls: list[dict] = []

    def request(self, method: str, url: str, **kwargs) -> FakeResponse:
        self.calls.append({"method": method, "url": url, **kwargs})
        return self.responses.pop(0)


def test_init_requires_client_secret_auth_method() -> None:
    session = FakeSession(
        [
            FakeResponse(
                {
                    "nonce": "nonce-1",
                    "supported_auth_methods": ["jwt"],
                }
            )
        ]
    )
    client = AppRegistrationClient(session=session)

    with pytest.raises(AppRegistrationError, match="client_secret"):
        client.init()


def test_begin_posts_official_registration_body_and_adds_qr_params() -> None:
    session = FakeSession(
        [
            FakeResponse(
                {
                    "device_code": "dev-123",
                    "user_code": "ABCD-EFGH",
                    "verification_uri": "https://accounts.feishu.cn/verify",
                    "verification_uri_complete": "https://accounts.feishu.cn/verify?device_code=dev-123",
                    "interval": 3,
                    "expire_in": 600,
                }
            )
        ]
    )
    client = AppRegistrationClient(brand="feishu", session=session)

    result = client.begin()

    call = session.calls[0]
    assert call["method"] == "POST"
    assert call["url"] == "https://accounts.feishu.cn/oauth/v1/app/registration"
    assert call["headers"]["Content-Type"] == "application/x-www-form-urlencoded"
    body = parse_qs(call["data"])
    assert body == {
        "action": ["begin"],
        "archetype": ["PersonalAgent"],
        "auth_method": ["client_secret"],
        "request_user_info": ["open_id"],
    }
    qr_query = parse_qs(urlparse(result.qr_url).query)
    assert qr_query["device_code"] == ["dev-123"]
    assert qr_query["from"] == ["oc_onboard"]
    assert qr_query["tp"] == ["ob_cli_app"]
    assert result.interval == 3
    assert result.expires_in == 600


def test_poll_handles_pending_slow_down_and_success() -> None:
    sleeps: list[float] = []
    session = FakeSession(
        [
            FakeResponse({"error": "authorization_pending"}),
            FakeResponse({"error": "slow_down"}),
            FakeResponse(
                {
                    "client_id": "cli_new",
                    "client_secret": "secret-new",
                    "user_info": {"open_id": "ou_owner", "tenant_brand": "feishu"},
                }
            ),
        ]
    )
    client = AppRegistrationClient(session=session, sleeper=sleeps.append)

    outcome = client.poll("dev-123", interval=2, expires_in=600, tp="ob_app")

    assert outcome.status == "success"
    assert outcome.result is not None
    assert outcome.result.app_id == "cli_new"
    assert outcome.result.app_secret == "secret-new"
    assert outcome.result.domain == "feishu"
    assert outcome.result.open_id == "ou_owner"
    assert sleeps == [2, 7]
    assert all(parse_qs(call["data"])["tp"] == ["ob_app"] for call in session.calls)


def test_poll_switches_to_lark_when_tenant_brand_is_lark() -> None:
    session = FakeSession(
        [
            FakeResponse({"user_info": {"tenant_brand": "lark"}}),
            FakeResponse(
                {
                    "client_id": "cli_lark",
                    "client_secret": "lark-secret",
                    "user_info": {"open_id": "ou_lark", "tenant_brand": "lark"},
                }
            ),
        ]
    )
    client = AppRegistrationClient(brand="feishu", session=session, sleeper=lambda _: None)

    outcome = client.poll("dev-123", interval=1, expires_in=600, tp="ob_app")

    assert outcome.status == "success"
    assert outcome.result is not None
    assert outcome.result.domain == "lark"
    assert session.calls[0]["url"].startswith("https://accounts.feishu.cn/")
    assert session.calls[1]["url"].startswith("https://accounts.larksuite.com/")

