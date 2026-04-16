from __future__ import annotations

from feishu_auth_kit.client import FeishuAuthClient
from feishu_auth_kit.probe import register_ai_agent


class FakeResponse:
    def __init__(self, payload: dict) -> None:
        self._payload = payload

    def json(self) -> dict:
        return self._payload

    def raise_for_status(self) -> None:
        return None


class FakeSession:
    def __init__(self, responses: list[FakeResponse]) -> None:
        self.responses = responses
        self.calls: list[dict] = []

    def request(self, method: str, url: str, **kwargs) -> FakeResponse:
        self.calls.append({"method": method, "url": url, **kwargs})
        return self.responses.pop(0)


def test_register_ai_agent_pings_official_openclaw_bot_endpoint() -> None:
    session = FakeSession(
        [
            FakeResponse({"code": 0, "tenant_access_token": "tenant-token", "expire": 7200}),
            FakeResponse(
                {
                    "code": 0,
                    "data": {"pingBotInfo": {"botID": "ou_bot", "botName": "Test Bot"}},
                }
            ),
        ]
    )
    client = FeishuAuthClient("cli_xxx", "secret", session=session)

    result = register_ai_agent(client)

    assert result.ok is True
    assert result.app_id == "cli_xxx"
    assert result.bot_open_id == "ou_bot"
    assert result.bot_name == "Test Bot"
    assert session.calls[1]["method"] == "POST"
    assert session.calls[1]["url"] == (
        "https://open.feishu.cn/open-apis/bot/v1/openclaw_bot/ping"
    )
    assert session.calls[1]["headers"]["Authorization"] == "Bearer tenant-token"
    assert session.calls[1]["json"] == {"needBotInfo": True}

