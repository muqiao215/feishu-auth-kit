from __future__ import annotations

from feishu_auth_kit.message_context import parse_feishu_message_context


def test_parse_feishu_message_context_extracts_native_fields() -> None:
    context = parse_feishu_message_context(
        {
            "schema": "2.0",
            "header": {
                "event_id": "evt_123",
                "event_type": "im.message.receive_v1",
                "app_id": "cli_xxx",
                "tenant_key": "tenant_123",
            },
            "event": {
                "sender": {
                    "sender_id": {
                        "open_id": "ou_user",
                        "user_id": "u_user",
                    }
                },
                "message": {
                    "message_id": "om_123",
                    "chat_id": "oc_123",
                    "chat_type": "p2p",
                    "message_type": "text",
                    "content": "{\"text\":\"@_user_1 帮我总结今天待办\"}",
                    "mentions": [
                        {
                            "key": "@_user_1",
                            "name": "bot",
                            "id": {"open_id": "ou_bot"},
                        }
                    ],
                },
            },
        }
    )

    assert context.schema == "feishu-auth-kit.message-context.v1"
    assert context.event_type == "im.message.receive_v1"
    assert context.app_id == "cli_xxx"
    assert context.tenant_key == "tenant_123"
    assert context.message_id == "om_123"
    assert context.chat_id == "oc_123"
    assert context.sender_open_id == "ou_user"
    assert context.text == "@_user_1 帮我总结今天待办"
    assert context.prompt_text() == "帮我总结今天待办"
    assert context.mentions[0].open_id == "ou_bot"

