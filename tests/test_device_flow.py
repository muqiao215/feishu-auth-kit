from __future__ import annotations

from feishu_auth_kit.device_flow import DeviceFlowClient


class FakeResponse:
    def __init__(self, payload: dict) -> None:
        self._payload = payload
        self.status_code = 200

    def json(self) -> dict:
        return self._payload

    def raise_for_status(self) -> None:
        return None


class FakeSession:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def request(self, method: str, url: str, **kwargs) -> FakeResponse:
        self.calls.append({"method": method, "url": url, **kwargs})
        return FakeResponse(
            {
                "device_code": "dev-123",
                "user_code": "ABCD-EFGH",
                "verification_uri": "https://example.test/verify",
                "verification_uri_complete": "https://example.test/verify?code=ABCD-EFGH",
                "expires_in": 600,
                "interval": 5,
            }
        )


def test_device_authorization_request_uses_form_body_and_adds_offline_access() -> None:
    session = FakeSession()
    client = DeviceFlowClient("cli_a1b2", "secret", session=session)

    auth = client.request_authorization(["im:message:readonly"])

    assert auth.device_code == "dev-123"
    assert len(session.calls) == 1
    call = session.calls[0]
    assert call["method"] == "POST"
    assert call["headers"]["Content-Type"] == "application/x-www-form-urlencoded"
    assert "scope=im%3Amessage%3Areadonly+offline_access" in call["data"]
    assert "client_id=cli_a1b2" in call["data"]
