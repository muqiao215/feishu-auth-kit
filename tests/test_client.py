from __future__ import annotations

from feishu_auth_kit.client import FeishuAuthClient, build_permission_url
from feishu_auth_kit.models import AppInfo


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


def test_build_permission_url_includes_scope_token_type_and_source() -> None:
    url = build_permission_url(
        app_id="cli_a1b2",
        scopes=["offline_access", "im:message:readonly"],
        brand="feishu",
        token_type="user",
        op_from="feishu-auth-kit",
    )

    assert url.startswith("https://open.feishu.cn/app/cli_a1b2/auth?")
    assert "q=offline_access%2Cim%3Amessage%3Areadonly" in url
    assert "token_type=user" in url
    assert "op_from=feishu-auth-kit" in url


def test_get_app_info_parses_scopes_and_token_types() -> None:
    session = FakeSession(
        [
            FakeResponse(
                {
                    "code": 0,
                    "tenant_access_token": "tenant-token",
                    "expire": 7200,
                }
            ),
            FakeResponse(
                {
                    "code": 0,
                    "data": {
                        "app": {
                            "app_id": "cli_a1b2",
                            "creator_id": "ou_creator",
                            "owner": {"owner_id": "ou_owner", "owner_type": 2},
                            "scopes": [
                                {
                                    "scope": "im:message:readonly",
                                    "token_types": ["user"],
                                },
                                {
                                    "scope": "application:application:self_manage",
                                    "token_types": ["tenant"],
                                },
                            ],
                        }
                    },
                }
            ),
        ]
    )
    client = FeishuAuthClient("cli_a1b2", "secret", session=session)

    app_info = client.get_app_info()

    assert isinstance(app_info, AppInfo)
    assert app_info.app_id == "cli_a1b2"
    assert app_info.creator_id == "ou_creator"
    assert app_info.owner_open_id == "ou_owner"
    assert app_info.effective_owner_open_id == "ou_owner"
    assert app_info.scopes[0].token_types == ["user"]
    assert client.get_granted_scopes(token_type="user") == ["im:message:readonly"]
    assert client.get_granted_scopes(token_type="tenant") == [
        "application:application:self_manage"
    ]
