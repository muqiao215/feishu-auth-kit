from __future__ import annotations

import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, Protocol

from .message_context import FeishuMessageContext

AgentEventKind = Literal["status", "tool_call", "tool_result", "assistant_message"]


@dataclass(frozen=True)
class AgentEvent:
    kind: AgentEventKind
    text: str | None = None
    tool_name: str | None = None
    tool_input: dict[str, Any] | str | None = None
    detail: str | None = None
    state: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def status(cls, text: str, *, metadata: dict[str, Any] | None = None) -> AgentEvent:
        return cls(kind="status", text=text, state="completed", metadata=metadata or {})

    @classmethod
    def tool_call(
        cls,
        tool_name: str,
        tool_input: dict[str, Any] | str | None = None,
        *,
        detail: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> AgentEvent:
        return cls(
            kind="tool_call",
            tool_name=tool_name,
            tool_input=tool_input,
            detail=detail,
            state="running",
            metadata=metadata or {},
        )

    @classmethod
    def tool_result(
        cls,
        tool_name: str,
        text: str,
        *,
        metadata: dict[str, Any] | None = None,
    ) -> AgentEvent:
        return cls(
            kind="tool_result",
            tool_name=tool_name,
            text=text,
            state="completed",
            metadata=metadata or {},
        )

    @classmethod
    def assistant_message(
        cls,
        text: str,
        *,
        metadata: dict[str, Any] | None = None,
    ) -> AgentEvent:
        return cls(
            kind="assistant_message",
            text=text,
            state="completed",
            metadata=metadata or {},
        )

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "kind": self.kind,
            "status": self.state,
            "text": self.text,
            "tool_name": self.tool_name,
            "tool_input": self.tool_input,
            "detail": self.detail,
            "metadata": self.metadata,
        }
        return {key: value for key, value in payload.items() if value not in (None, {})}


@dataclass(frozen=True)
class AgentTurnRequest:
    context: FeishuMessageContext
    prompt: str
    system_prompt: str | None = None
    session_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_message_context(
        cls,
        context: FeishuMessageContext,
        *,
        prompt: str | None = None,
        system_prompt: str | None = None,
        session_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> AgentTurnRequest:
        return cls(
            context=context,
            prompt=prompt if prompt is not None else context.prompt_text(),
            system_prompt=system_prompt,
            session_id=session_id,
            metadata=metadata or {},
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema": "feishu-auth-kit.agent-turn-request.v1",
            "prompt": self.prompt,
            "system_prompt": self.system_prompt,
            "session_id": self.session_id,
            "context": self.context.to_dict(),
            "metadata": self.metadata,
        }


@dataclass(frozen=True)
class AgentTurnResult:
    runner: str
    output_text: str
    events: list[AgentEvent] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema": "feishu-auth-kit.agent-turn-result.v1",
            "runner": self.runner,
            "output_text": self.output_text,
            "events": [event.to_dict() for event in self.events],
            "metadata": self.metadata,
        }


class AgentRunner(Protocol):
    name: str

    def run(self, request: AgentTurnRequest) -> AgentTurnResult:
        raise NotImplementedError


class EchoRunner:
    name = "echo"

    def __init__(self, *, prefix: str = "Echo") -> None:
        self.prefix = prefix

    def run(self, request: AgentTurnRequest) -> AgentTurnResult:
        output_text = f"{self.prefix}: {request.prompt}"
        return AgentTurnResult(
            runner=self.name,
            output_text=output_text,
            events=[
                AgentEvent.status("Message context normalized"),
                AgentEvent.assistant_message(output_text),
            ],
            metadata={"message_id": request.context.message_id},
        )


def build_codex_prompt(request: AgentTurnRequest) -> str:
    parts = [
        "You are running inside a Feishu native agent runtime adapter.",
        "Return the final reply text for the Feishu user.",
        "",
        "Feishu message context:",
        f"- event_type: {request.context.event_type or '(unknown)'}",
        f"- message_id: {request.context.message_id or '(unknown)'}",
        f"- chat_id: {request.context.chat_id or '(unknown)'}",
        f"- sender_open_id: {request.context.sender_open_id or '(unknown)'}",
    ]
    if request.session_id:
        parts.append(f"- session_id: {request.session_id}")
    if request.system_prompt:
        parts.extend(["", "Runtime instructions:", request.system_prompt.strip()])
    parts.extend(["", "User message:", request.prompt])
    return "\n".join(parts).strip()


class CodexCliRunner:
    name = "codex_cli"

    def __init__(
        self,
        *,
        codex_bin: str = "codex",
        model: str | None = None,
        cwd: str | Path | None = None,
        extra_args: list[str] | None = None,
        timeout: int = 180,
    ) -> None:
        self.codex_bin = codex_bin
        self.model = model
        self.cwd = Path(cwd).expanduser() if cwd else None
        self.extra_args = extra_args or []
        self.timeout = timeout

    def run(self, request: AgentTurnRequest) -> AgentTurnResult:
        prompt = build_codex_prompt(request)
        with tempfile.NamedTemporaryFile("w+", encoding="utf-8", delete=True) as last_message:
            command = [
                self.codex_bin,
                "exec",
                "--skip-git-repo-check",
                "--color",
                "never",
                "-o",
                last_message.name,
            ]
            if self.model:
                command.extend(["-m", self.model])
            if self.cwd:
                command.extend(["-C", str(self.cwd)])
            command.extend(self.extra_args)
            command.append("-")
            completed = subprocess.run(
                command,
                input=prompt,
                text=True,
                capture_output=True,
                timeout=self.timeout,
                check=False,
            )
            last_message.seek(0)
            output_text = last_message.read().strip() or completed.stdout.strip()
        if completed.returncode != 0:
            raise RuntimeError(
                "Codex CLI failed with exit "
                f"{completed.returncode}: {completed.stderr.strip() or completed.stdout.strip()}"
            )
        return AgentTurnResult(
            runner=self.name,
            output_text=output_text,
            events=[
                AgentEvent.status("Codex CLI completed"),
                AgentEvent.assistant_message(output_text),
            ],
            metadata={
                "codex_bin": self.codex_bin,
                "model": self.model,
                "cwd": str(self.cwd) if self.cwd else None,
                "stderr_present": bool(completed.stderr.strip()),
            },
        )
