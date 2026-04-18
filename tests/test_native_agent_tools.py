from __future__ import annotations

from feishu_auth_kit import (
    build_native_agent_tool_selection_prompt,
    build_tool_result_followup_prompt,
    native_agent_tool_specs,
    parse_native_agent_tool_selection,
)


def test_native_agent_tool_specs_include_contact_search() -> None:
    specs = {spec.name: spec for spec in native_agent_tool_specs()}

    assert "contact.search_user" in specs
    assert specs["contact.search_user"].parameters["query"] == "string"


def test_parse_native_agent_tool_selection_accepts_known_tool() -> None:
    selection = parse_native_agent_tool_selection(
        '{"tool_name":"contact.search_user","arguments":{"query":"Alice"}}'
    )

    assert selection is not None
    assert selection.tool_name == "contact.search_user"
    assert selection.arguments == {"query": "Alice"}


def test_parse_native_agent_tool_selection_rejects_none_and_unknown() -> None:
    assert parse_native_agent_tool_selection('{"tool_name":"none","arguments":{}}') is None
    assert parse_native_agent_tool_selection('{"tool_name":"unknown","arguments":{}}') is None


def test_build_native_agent_tool_selection_prompt_includes_context() -> None:
    prompt = build_native_agent_tool_selection_prompt(
        user_text="帮我找 Alice",
        inbound_context={"chat_id": "oc_123", "sender_open_id": "ou_123"},
    )

    assert "Feishu native tool selector" in prompt
    assert "contact.search_user" in prompt
    assert '"chat_id": "oc_123"' in prompt
    assert "帮我找 Alice" in prompt


def test_build_tool_result_followup_prompt_includes_result() -> None:
    prompt = build_tool_result_followup_prompt(
        original_text="帮我找 Alice",
        tool_name="contact.search_user",
        arguments={"query": "Alice"},
        result={"users": [{"name": "Alice"}]},
    )

    assert "帮我找 Alice" in prompt
    assert "contact.search_user" in prompt
    assert '"Alice"' in prompt
    assert "Do not emit another Feishu native tool selection JSON." in prompt
