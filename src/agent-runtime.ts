import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { FeishuMessageContext } from './message-context.js';

export type AgentEventKind =
  | 'status'
  | 'start'
  | 'running'
  | 'completed'
  | 'error'
  | 'stderr_warning'
  | 'tool_call'
  | 'tool_result'
  | 'assistant_message';

export class AgentEvent {
  readonly kind: AgentEventKind;
  readonly text: string | null;
  readonly toolName: string | null;
  readonly toolInput: Record<string, any> | string | null;
  readonly detail: string | null;
  readonly state: string | null;
  readonly metadata: Record<string, any>;

  constructor(options: {
    kind: AgentEventKind;
    text?: string | null;
    toolName?: string | null;
    toolInput?: Record<string, any> | string | null;
    detail?: string | null;
    state?: string | null;
    metadata?: Record<string, any>;
  }) {
    this.kind = options.kind;
    this.text = options.text ?? null;
    this.toolName = options.toolName ?? null;
    this.toolInput = options.toolInput ?? null;
    this.detail = options.detail ?? null;
    this.state = options.state ?? null;
    this.metadata = options.metadata ? { ...options.metadata } : {};
  }

  static status(text: string, metadata?: Record<string, any>): AgentEvent {
    return new AgentEvent({
      kind: 'status',
      text,
      state: 'completed',
      metadata: metadata || {},
    });
  }

  static toolCall(
    toolName: string,
    toolInput?: Record<string, any> | string | null,
    options?: { detail?: string | null; metadata?: Record<string, any> },
  ): AgentEvent {
    return new AgentEvent({
      kind: 'tool_call',
      toolName,
      toolInput,
      detail: options?.detail,
      state: 'running',
      metadata: options?.metadata || {},
    });
  }

  static toolResult(
    toolName: string,
    text: string,
    metadata?: Record<string, any>,
  ): AgentEvent {
    return new AgentEvent({
      kind: 'tool_result',
      toolName,
      text,
      state: 'completed',
      metadata: metadata || {},
    });
  }

  static assistantMessage(
    text: string,
    metadata?: Record<string, any>,
  ): AgentEvent {
    return new AgentEvent({
      kind: 'assistant_message',
      text,
      state: 'completed',
      metadata: metadata || {},
    });
  }

  static start(text: string, metadata?: Record<string, any>): AgentEvent {
    return new AgentEvent({
      kind: 'start',
      text,
      state: 'start',
      metadata: metadata || {},
    });
  }

  static running(text: string, metadata?: Record<string, any>): AgentEvent {
    return new AgentEvent({
      kind: 'running',
      text,
      state: 'running',
      metadata: metadata || {},
    });
  }

  static completed(text: string, metadata?: Record<string, any>): AgentEvent {
    return new AgentEvent({
      kind: 'completed',
      text,
      state: 'completed',
      metadata: metadata || {},
    });
  }

  static error(
    text: string,
    options?: { detail?: string | null; metadata?: Record<string, any> },
  ): AgentEvent {
    return new AgentEvent({
      kind: 'error',
      text,
      detail: options?.detail,
      state: 'error',
      metadata: options?.metadata || {},
    });
  }

  static stderrWarning(text: string, metadata?: Record<string, any>): AgentEvent {
    return new AgentEvent({
      kind: 'stderr_warning',
      text,
      state: 'completed',
      metadata: metadata || {},
    });
  }

  toDict(): Record<string, any> {
    const payload: Record<string, any> = {
      kind: this.kind,
      status: this.state,
      text: this.text,
      tool_name: this.toolName,
      tool_input: this.toolInput,
      detail: this.detail,
      metadata: this.metadata,
    };
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (value === null || value === undefined) {
        continue;
      }
      if (
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.keys(value).length === 0
      ) {
        continue;
      }
      result[key] = value;
    }
    return result;
  }
}

export class AgentTurnRequest {
  readonly context: FeishuMessageContext;
  readonly prompt: string;
  readonly systemPrompt: string | null;
  readonly sessionId: string | null;
  readonly metadata: Record<string, any>;

  constructor(options: {
    context: FeishuMessageContext;
    prompt: string;
    systemPrompt?: string | null;
    sessionId?: string | null;
    metadata?: Record<string, any>;
  }) {
    this.context = options.context;
    this.prompt = options.prompt;
    this.systemPrompt = options.systemPrompt ?? null;
    this.sessionId = options.sessionId ?? null;
    this.metadata = options.metadata ? { ...options.metadata } : {};
  }

  static fromMessageContext(
    context: FeishuMessageContext,
    options?: {
      prompt?: string | null;
      systemPrompt?: string | null;
      sessionId?: string | null;
      metadata?: Record<string, any>;
    },
  ): AgentTurnRequest {
    return new AgentTurnRequest({
      context,
      prompt: options?.prompt !== undefined && options?.prompt !== null ? options.prompt : context.promptText(),
      systemPrompt: options?.systemPrompt,
      sessionId: options?.sessionId,
      metadata: options?.metadata,
    });
  }

  toDict(): Record<string, any> {
    return {
      schema: 'feishu-auth-kit.agent-turn-request.v1',
      prompt: this.prompt,
      system_prompt: this.systemPrompt,
      session_id: this.sessionId,
      context: this.context.toDict(),
      metadata: this.metadata,
    };
  }
}

export class AgentTurnResult {
  readonly runner: string;
  readonly outputText: string;
  readonly status: string;
  readonly events: AgentEvent[];
  readonly metadata: Record<string, any>;

  constructor(options: {
    runner: string;
    outputText: string;
    status?: string;
    events?: AgentEvent[];
    metadata?: Record<string, any>;
  }) {
    this.runner = options.runner;
    this.outputText = options.outputText;
    this.status = options.status ?? 'completed';
    this.events = options.events ? [...options.events] : [];
    this.metadata = options.metadata ? { ...options.metadata } : {};
  }

  toDict(): Record<string, any> {
    return {
      schema: 'feishu-auth-kit.agent-turn-result.v1',
      runner: this.runner,
      output_text: this.outputText,
      status: this.status,
      events: this.events.map((event) => event.toDict()),
      metadata: this.metadata,
    };
  }
}

export interface AgentRunner {
  name: string;
  run(request: AgentTurnRequest): AgentTurnResult | Promise<AgentTurnResult>;
}

export class EchoRunner implements AgentRunner {
  readonly name = 'echo';
  readonly prefix: string;

  constructor(options?: { prefix?: string }) {
    this.prefix = options?.prefix ?? 'Echo';
  }

  run(request: AgentTurnRequest): AgentTurnResult {
    const outputText = `${this.prefix}: ${request.prompt}`;
    return new AgentTurnResult({
      runner: this.name,
      outputText,
      events: [
        AgentEvent.status('Message context normalized'),
        AgentEvent.assistantMessage(outputText),
      ],
      metadata: { message_id: request.context.messageId },
    });
  }
}

export function buildCodexPrompt(request: AgentTurnRequest): string {
  const parts = [
    'You are running inside a Feishu native agent runtime adapter.',
    'Return the final reply text for the Feishu user.',
    '',
    'Feishu message context:',
    `- event_type: ${request.context.eventType || '(unknown)'}`,
    `- message_id: ${request.context.messageId || '(unknown)'}`,
    `- chat_id: ${request.context.chatId || '(unknown)'}`,
    `- sender_open_id: ${request.context.senderOpenId || '(unknown)'}`,
  ];
  if (request.sessionId) {
    parts.push(`- session_id: ${request.sessionId}`);
  }
  if (request.systemPrompt) {
    parts.push('', 'Runtime instructions:', request.systemPrompt.trim());
  }
  parts.push('', 'User message:', request.prompt);
  return parts.join('\n').trim();
}

export class CodexCliRunner implements AgentRunner {
  readonly name = 'codex_cli';
  readonly codexBin: string;
  readonly model: string | null;
  readonly cwd: string | null;
  readonly extraArgs: string[];
  readonly timeout: number;
  readonly spawnSyncFn: typeof spawnSync;

  constructor(options?: {
    codexBin?: string;
    model?: string | null;
    cwd?: string | null;
    extraArgs?: string[];
    timeout?: number;
    spawnSyncFn?: typeof spawnSync;
  }) {
    this.codexBin = options?.codexBin ?? 'codex';
    this.model = options?.model ?? null;
    this.cwd = options?.cwd ? path.resolve(options.cwd) : null;
    this.extraArgs = options?.extraArgs ?? [];
    this.timeout = options?.timeout ?? 180;
    this.spawnSyncFn = options?.spawnSyncFn ?? spawnSync;
  }

  private _command(outputPath: string): string[] {
    const command = [
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--color',
      'never',
      '-o',
      outputPath,
    ];
    if (this.model) {
      command.push('-m', this.model);
    }
    if (this.cwd) {
      command.push('-C', this.cwd);
    }
    command.push(...this.extraArgs);
    command.push('-');
    return command;
  }

  private _parseJsonEvents(stdout: string): AgentEvent[] {
    const events: AgentEvent[] = [];
    for (const rawLine of stdout.split('\n')) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }
      let payload: Record<string, any>;
      try {
        payload = JSON.parse(line);
      } catch {
        continue;
      }
      const eventType = payload.type;
      if (eventType === 'thread.started') {
        events.push(
          AgentEvent.start('Codex thread started', {
            thread_id: payload.thread_id,
          }),
        );
      } else if (eventType === 'turn.started') {
        events.push(AgentEvent.running('Codex turn started'));
      } else if (eventType === 'item.started') {
        const item = payload.item || {};
        if (item.type === 'command_execution') {
          const command = String(item.command || '');
          events.push(
            AgentEvent.toolCall('shell.command', { command }, {
              detail: command,
              metadata: { item_id: item.id, status: item.status },
            }),
          );
        }
      } else if (eventType === 'item.completed') {
        const item = payload.item || {};
        const itemType = item.type;
        if (itemType === 'command_execution') {
          events.push(
            AgentEvent.toolResult(
              'shell.command',
              String(item.aggregated_output || '').trimEnd(),
              {
                item_id: item.id,
                exit_code: item.exit_code,
                status: item.status,
                command: item.command,
              },
            ),
          );
        } else if (itemType === 'agent_message') {
          events.push(
            AgentEvent.assistantMessage(String(item.text || ''), {
              item_id: item.id,
            }),
          );
        }
      } else if (eventType === 'turn.completed') {
        events.push(
          AgentEvent.completed('Codex turn completed', {
            usage: payload.usage || {},
          }),
        );
      }
    }
    return events;
  }

  run(request: AgentTurnRequest): AgentTurnResult {
    const prompt = buildCodexPrompt(request);
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feishu-codex-'));
    const lastMessagePath = path.join(tempDir, 'last_message.txt');

    let stdout = '';
    let stderr = '';
    let returncode = 0;

    try {
      const args = this._command(lastMessagePath);
      const res = this.spawnSyncFn(this.codexBin, args, {
        input: prompt,
        encoding: 'utf-8',
        timeout: this.timeout * 1000,
        cwd: this.cwd || undefined,
      });
      stdout = res.stdout || '';
      stderr = res.stderr || '';
      returncode = res.status ?? (res.error ? 1 : 0);
    } finally {
      // We will read lastMessagePath before cleanup
    }

    let outputText = '';
    if (fs.existsSync(lastMessagePath)) {
      outputText = fs.readFileSync(lastMessagePath, 'utf-8').trim();
    }
    if (!outputText) {
      outputText = stdout.trim();
    }

    try {
      if (fs.existsSync(lastMessagePath)) {
        fs.unlinkSync(lastMessagePath);
      }
      fs.rmdirSync(tempDir);
    } catch {
      // ignore cleanup errors
    }

    let events = this._parseJsonEvents(stdout);
    const stderrText = stderr.trim();
    if (events.length === 0) {
      events = [
        AgentEvent.start('Codex run started'),
        AgentEvent.running('Codex run executing'),
      ];
      if (outputText) {
        events.push(AgentEvent.assistantMessage(outputText));
      }
    }
    if (returncode === 0 && !events.some((e) => e.kind === 'completed')) {
      events.push(AgentEvent.completed('Codex run completed'));
    }
    if (returncode !== 0) {
      events.push(
        AgentEvent.error('Codex CLI failed', {
          detail: stderrText || stdout.trim(),
          metadata: { returncode },
        }),
      );
    }
    if (stderrText) {
      events.push(
        AgentEvent.stderrWarning(stderrText.split('\n')[0], {
          line_count: stderrText.split('\n').length,
        }),
      );
    }

    return new AgentTurnResult({
      runner: this.name,
      outputText,
      status: returncode === 0 ? 'completed' : 'error',
      events,
      metadata: {
        codex_bin: this.codexBin,
        model: this.model,
        cwd: this.cwd,
        returncode,
        stderr_present: Boolean(stderrText),
        json_event_count: events.length,
      },
    });
  }
}
