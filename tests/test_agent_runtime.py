from __future__ import annotations

from feishu_auth_kit.agent_runtime import (
    AgentEvent,
    AgentTurnRequest,
    AgentTurnResult,
    EchoRunner,
)
from feishu_auth_kit.cardkit import build_single_card_run
from feishu_auth_kit.message_context import FeishuMessageContext


def _context() -> FeishuMessageContext:
    return FeishuMessageContext(
        event_id="evt_123",
        event_type="im.message.receive_v1",
        app_id="cli_xxx",
        tenant_key="tenant_123",
        chat_id="oc_123",
        chat_type="p2p",
        message_id="om_123",
        message_type="text",
        sender_open_id="ou_user",
        sender_user_id="u_user",
        text="@_user_1 帮我总结今天待办",
    )


def test_echo_runner_uses_prompt_text_from_message_context() -> None:
    request = AgentTurnRequest.from_message_context(_context())

    result = EchoRunner(prefix="Codex stub").run(request)

    assert result.runner == "echo"
    assert result.output_text == "Codex stub: 帮我总结今天待办"
    assert result.events[-1].kind == "assistant_message"


def test_cardkit_single_card_keeps_tool_steps_and_final_text() -> None:
    result = AgentTurnResult(
        runner="codex_cli",
        output_text="我已经找到 Alice 的联系方式。",
        events=[
            AgentEvent.status("已接收消息"),
            AgentEvent.tool_call(
                "contact.search",
                {"query": "Alice"},
                detail="查询飞书联系人",
            ),
            AgentEvent.tool_result(
                "contact.search",
                "命中 1 条联系人记录",
            ),
            AgentEvent.assistant_message("我已经找到 Alice 的联系方式。"),
        ],
    )

    card = build_single_card_run(_context(), result)
    payload = card.to_dict()

    assert payload["schema"] == "feishu-auth-kit.cardkit.single_card.v1"
    assert payload["message_id"] == "om_123"
    assert payload["runner"] == "codex_cli"
    assert payload["summary"] == "我已经找到 Alice 的联系方式。"
    assert payload["steps"][1]["kind"] == "tool_call"
    assert payload["steps"][1]["title"] == "Tool: contact.search"
    assert payload["steps"][2]["kind"] == "tool_result"
    assert payload["final_text"] == "我已经找到 Alice 的联系方式。"

