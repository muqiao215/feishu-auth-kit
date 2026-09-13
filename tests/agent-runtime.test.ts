import fs from 'node:fs';
import * as childProcess from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import {
  AgentEvent,
  AgentTurnRequest,
  AgentTurnResult,
  CodexCliRunner,
  EchoRunner,
} from '../src/agent-runtime.js';
import { buildSingleCardRun } from '../src/cardkit.js';
import { FeishuMessageContext } from '../src/message-context.js';

function makeContext(): FeishuMessageContext {
  return new FeishuMessageContext({
    event_id: 'evt_123',
    event_type: 'im.message.receive_v1',
    app_id: 'cli_xxx',
    tenant_key: 'tenant_123',
    chat_id: 'oc_123',
    chat_type: 'p2p',
    message_id: 'om_123',
    message_type: 'text',
    sender_open_id: 'ou_user',
    sender_user_id: 'u_user',
    text: '@_user_1 帮我总结今天待办',
  });
}

describe('agent-runtime', () => {
  it('echo runner uses prompt text from message context', () => {
    const request = AgentTurnRequest.fromMessageContext(makeContext());
    const result = new EchoRunner({ prefix: 'Codex stub' }).run(request);

    expect(result.runner).toBe('echo');
    expect(result.outputText).toBe('Codex stub: 帮我总结今天待办');
    expect(result.events[result.events.length - 1].kind).toBe('assistant_message');
  });

  it('cardkit single card keeps tool steps and final text', () => {
    const result = new AgentTurnResult({
      runner: 'codex_cli',
      outputText: '我已经找到 Alice 的联系方式。',
      events: [
        AgentEvent.status('已接收消息'),
        AgentEvent.toolCall('contact.search', { query: 'Alice' }, {
          detail: '查询飞书联系人',
        }),
        AgentEvent.toolResult('contact.search', '命中 1 条联系人记录'),
        AgentEvent.assistantMessage('我已经找到 Alice 的联系方式。'),
      ],
    });

    const card = buildSingleCardRun(makeContext(), result);
    const payload = card.toDict();

    expect(payload.schema).toBe('feishu-auth-kit.cardkit.single_card.v1');
    expect(payload.message_id).toBe('om_123');
    expect(payload.runner).toBe('codex_cli');
    expect(payload.summary).toBe('我已经找到 Alice 的联系方式。');
    expect(payload.steps[1].kind).toBe('tool_call');
    expect(payload.steps[1].title).toBe('Tool: contact.search');
    expect(payload.steps[2].kind).toBe('tool_result');
    expect(payload.final_text).toBe('我已经找到 Alice 的联系方式。');
  });

  it('codex cli runner parses json events into lifecycle and tool steps', () => {
    const commandStarted =
      '{"type":"item.started","item":{"id":"item_0","type":"command_execution",' +
      '"command":"/bin/bash -lc pwd","status":"in_progress"}}';
    const commandCompleted =
      '{"type":"item.completed","item":{"id":"item_0","type":"command_execution",' +
      '"command":"/bin/bash -lc pwd","aggregated_output":"/tmp\\n",' +
      '"exit_code":0,"status":"completed"}}';

    const stdout = [
      '{"type":"thread.started","thread_id":"thread-1"}',
      '{"type":"turn.started"}',
      commandStarted,
      commandCompleted,
      '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"最终答案"}}',
      '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":2}}',
    ].join('\n');

    const fakeSpawnSync = ((cmd: string, args?: string[]) => {
      const outputPath = args?.[args.indexOf('-o') + 1];
      if (outputPath) {
        fs.writeFileSync(outputPath, '最终答案', 'utf-8');
      }
      return {
        pid: 1234,
        output: [null, stdout, 'warning: partial stderr'],
        stdout,
        stderr: 'warning: partial stderr',
        status: 0,
        signal: null,
      } as any;
    }) as any;

    const request = AgentTurnRequest.fromMessageContext(makeContext());
    const runner = new CodexCliRunner({ codexBin: 'codex', spawnSyncFn: fakeSpawnSync });
    const result = runner.run(request);

    expect(result.status).toBe('completed');
    expect(result.outputText).toBe('最终答案');
    expect(result.events.map((e) => e.kind)).toEqual([
      'start',
      'running',
      'tool_call',
      'tool_result',
      'assistant_message',
      'completed',
      'stderr_warning',
    ]);
    expect(result.events[2].toolName).toBe('shell.command');
    expect(result.events[3].metadata.exit_code).toBe(0);
    expect(result.events[result.events.length - 1].kind).toBe('stderr_warning');

    vi.restoreAllMocks();
  });
});
