from __future__ import annotations

from subprocess import CompletedProcess

from feishu_auth_kit.agent_runtime import (
    AgentEvent,
    AgentTurnRequest,
    AgentTurnResult,
    CodexCliRunner,
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


def test_codex_cli_runner_parses_json_events_into_lifecycle_and_tool_steps(monkeypatch) -> None:
    command_started = (
        '{"type":"item.started","item":{"id":"item_0","type":"command_execution",'
        '"command":"/bin/bash -lc pwd","status":"in_progress"}}'
    )
    command_completed = (
        '{"type":"item.completed","item":{"id":"item_0","type":"command_execution",'
        '"command":"/bin/bash -lc pwd","aggregated_output":"/tmp\\\\n",'
        '"exit_code":0,"status":"completed"}}'
    )

    def fake_run(command, *, input, text, capture_output, timeout, check):  # noqa: ANN001
        output_path = command[command.index("-o") + 1]
        assert "--json" in command
        assert input.endswith("帮我总结今天待办")
        with open(output_path, "w", encoding="utf-8") as handle:
            handle.write("最终答案")
        return CompletedProcess(
            args=command,
            returncode=0,
            stdout="\n".join(
                [
                    '{"type":"thread.started","thread_id":"thread-1"}',
                    '{"type":"turn.started"}',
                    command_started,
                    command_completed,
                    '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"最终答案"}}',
                    '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":2}}',
                ]
            ),
            stderr="warning: partial stderr",
        )

    monkeypatch.setattr("feishu_auth_kit.agent_runtime.subprocess.run", fake_run)

    request = AgentTurnRequest.from_message_context(_context())
    result = CodexCliRunner(codex_bin="codex").run(request)

    assert result.status == "completed"
    assert result.output_text == "最终答案"
    assert [event.kind for event in result.events] == [
        "start",
        "running",
        "tool_call",
        "tool_result",
        "assistant_message",
        "completed",
        "stderr_warning",
    ]
    assert result.events[2].tool_name == "shell.command"
    assert result.events[3].metadata["exit_code"] == 0
    assert result.events[-1].kind == "stderr_warning"
