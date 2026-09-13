import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as appReg from '../src/app-registration.js';
import { main } from '../src/cli.js';
import { AuthContinuation } from '../src/orchestration.js';
import { FileContinuationStore } from '../src/runtime-cards.js';

async function runCli(argv: string[]): Promise<{ code: number; stdout: string }> {
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...args: any[]) => logs.push(args.map(String).join(' '));
  try {
    const code = await main(argv);
    return { code, stdout: logs.join('\n') };
  } finally {
    console.log = origLog;
  }
}

describe('cli', () => {
  it('setup output contains manual open platform steps', async () => {
    const { code, stdout } = await runCli(['setup']);

    expect(code).toBe(0);
    expect(stdout).toContain('Feishu / Lark app setup guide');
    expect(stdout).toContain('official scan-to-create app registration flow');
    expect(stdout).toContain('Open Platform approval');
    expect(stdout).toContain('application:application:self_manage');
    expect(stdout).toContain('offline_access');
  });

  it('runtime permission-card command emits json and persists continuation', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-test-'));
    const continuationPath = path.join(tmpDir, 'continuations.json');

    const { code, stdout } = await runCli([
      'runtime',
      'permission-card',
      '--app-id',
      'cli_xxx',
      '--scope',
      'offline_access',
      '--permission-url',
      'https://open.feishu.cn/app/cli_xxx/auth?q=offline_access',
      '--operation-id',
      'op-123',
      '--continuation-store-path',
      continuationPath,
    ]);

    const payload = JSON.parse(stdout);
    expect(code).toBe(0);
    expect(payload.type).toBe('permission_missing');
    expect(payload.operation_id).toBe('op-123');

    const stored = JSON.parse(fs.readFileSync(continuationPath, 'utf-8'));
    expect(stored.continuations['op-123']).toBeDefined();

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('tokens commands can save and report status', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-test-'));
    const tokenPath = path.join(tmpDir, 'tokens.json');

    const saveRes = await runCli([
      'tokens',
      'save',
      '--app-id',
      'cli_xxx',
      '--user-open-id',
      'ou_user',
      '--access-token',
      'access-token',
      '--scope',
      'offline_access',
      '--token-store-path',
      tokenPath,
    ]);
    expect(saveRes.code).toBe(0);

    const statusRes = await runCli([
      'tokens',
      'status',
      '--app-id',
      'cli_xxx',
      '--user-open-id',
      'ou_user',
      '--token-store-path',
      tokenPath,
      '--json',
    ]);
    const payload = JSON.parse(statusRes.stdout);

    expect(statusRes.code).toBe(0);
    expect(payload.exists).toBe(true);
    expect(payload.scope).toBe('offline_access');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('orchestration plan command emits scope diff', async () => {
    const { code, stdout } = await runCli([
      'orchestration',
      'plan',
      '--requested-scope',
      'offline_access,im:message:readonly',
      '--app-scope',
      'offline_access,im:message:readonly',
      '--user-scope',
      'offline_access',
    ]);

    const payload = JSON.parse(stdout);
    expect(code).toBe(0);
    expect(payload.missing_user_scopes).toEqual(['im:message:readonly']);
    expect(payload.already_granted_scopes).toEqual(['offline_access']);
  });

  it('orchestration route command reuses pending flow and persists state', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-test-'));
    const continuationPath = path.join(tmpDir, 'continuations.json');
    const pendingPath = path.join(tmpDir, 'pending.json');

    const args1 = [
      'orchestration',
      'route',
      '--app-id',
      'cli_xxx',
      '--error-kind',
      'app_scope_missing',
      '--required-scope',
      'offline_access',
      '--user-open-id',
      'ou_user',
      '--flow-key',
      'flow-1',
      '--permission-url',
      'https://open.feishu.cn/app/cli_xxx/auth?q=offline_access',
      '--continuation-store-path',
      continuationPath,
      '--pending-flow-store-path',
      pendingPath,
    ];

    const first = await runCli(args1);
    const firstOutput = JSON.parse(first.stdout);

    const args2 = [
      'orchestration',
      'route',
      '--app-id',
      'cli_xxx',
      '--error-kind',
      'app_scope_missing',
      '--required-scope',
      'offline_access',
      '--required-scope',
      'im:message:readonly',
      '--user-open-id',
      'ou_user',
      '--flow-key',
      'flow-1',
      '--permission-url',
      'https://open.feishu.cn/app/cli_xxx/auth?q=offline_access',
      '--continuation-store-path',
      continuationPath,
      '--pending-flow-store-path',
      pendingPath,
    ];

    const second = await runCli(args2);
    const secondOutput = JSON.parse(second.stdout);

    expect(first.code).toBe(0);
    expect(second.code).toBe(0);
    expect(firstOutput.flow.operation_id).toBe(secondOutput.flow.operation_id);
    expect(secondOutput.reused_existing_flow).toBe(true);
    expect(secondOutput.flow.required_scopes).toEqual(['offline_access', 'im:message:readonly']);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('orchestration retry command builds artifact from continuation', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-test-'));
    const continuationPath = path.join(tmpDir, 'continuations.json');

    await runCli([
      'orchestration',
      'route',
      '--app-id',
      'cli_xxx',
      '--error-kind',
      'app_scope_missing',
      '--required-scope',
      'offline_access',
      '--user-open-id',
      'ou_user',
      '--flow-key',
      'flow-1',
      '--operation-id',
      'op-123',
      '--permission-url',
      'https://open.feishu.cn/app/cli_xxx/auth?q=offline_access',
      '--continuation-store-path',
      continuationPath,
      '--pending-flow-store-path',
      path.join(tmpDir, 'pending.json'),
    ]);

    const { code, stdout } = await runCli([
      'orchestration',
      'retry',
      '--operation-id',
      'op-123',
      '--text',
      '请继续之前的操作',
      '--continuation-store-path',
      continuationPath,
    ]);

    const payload = JSON.parse(stdout);
    expect(code).toBe(0);
    expect(payload.kind).toBe('synthetic_retry');
    expect(payload.operation_id).toBe('op-123');
    expect(payload.user_open_id).toBe('ou_user');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('register scan-create no-poll emits structured payload', async () => {
    vi.spyOn(appReg.AppRegistrationClient.prototype, 'init').mockResolvedValue({
      nonce: 'nonce-1',
      supported_auth_methods: ['client_secret'],
    });
    vi.spyOn(appReg.AppRegistrationClient.prototype, 'begin').mockResolvedValue({
      device_code: 'dev-123',
      qr_url: 'https://accounts.feishu.cn/verify?device_code=dev-123&from=oc_onboard&tp=ob_cli_app',
      user_code: 'ABCD-EFGH',
      interval: 5,
      expires_in: 600,
      verification_uri: 'https://accounts.feishu.cn/verify',
      verification_uri_complete: 'https://accounts.feishu.cn/verify?device_code=dev-123',
    });

    const { code, stdout } = await runCli(['register', 'scan-create', '--no-poll', '--json']);
    const payload = JSON.parse(stdout);

    expect(code).toBe(0);
    expect(payload.status).toBe('authorization_required');
    expect(payload.device_code).toBe('dev-123');
    expect(payload.qr_url.startsWith('https://accounts.feishu.cn/verify')).toBe(true);
    expect(payload.interval).toBe(5);
    expect(payload.expires_in).toBe(600);

    vi.restoreAllMocks();
  });

  it('register poll command emits success payload', async () => {
    vi.spyOn(appReg.AppRegistrationClient.prototype, 'poll').mockResolvedValue({
      status: 'success',
      result: {
        app_id: 'cli_new',
        app_secret: 'secret-new',
        domain: 'feishu',
        open_id: 'ou_owner',
      },
    });

    const { code, stdout } = await runCli([
      'register',
      'poll',
      '--device-code',
      'dev-123',
      '--interval',
      '5',
      '--expires-in',
      '600',
      '--poll-timeout',
      '30',
      '--json',
    ]);
    const payload = JSON.parse(stdout);

    expect(code).toBe(0);
    expect(payload.status).toBe('success');
    expect(payload.app_id).toBe('cli_new');
    expect(payload.app_secret).toBe('secret-new');
    expect(payload.domain).toBe('feishu');

    vi.restoreAllMocks();
  });

  it('agent parse-inbound command emits normalized message context', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-test-'));
    const eventPath = path.join(tmpDir, 'event.json');
    fs.writeFileSync(
      eventPath,
      JSON.stringify({
        header: {
          event_id: 'evt_123',
          event_type: 'im.message.receive_v1',
          app_id: 'cli_xxx',
          tenant_key: 'tenant_123',
        },
        event: {
          sender: {
            sender_id: {
              open_id: 'ou_user',
              user_id: 'u_user',
            },
          },
          message: {
            message_id: 'om_123',
            chat_id: 'oc_123',
            chat_type: 'p2p',
            message_type: 'text',
            content: '{"text":"@_user_1 帮我总结今天待办"}',
            mentions: [
              {
                key: '@_user_1',
                name: 'bot',
                id: { open_id: 'ou_bot' },
              },
            ],
          },
        },
      }),
      'utf-8',
    );

    const { code, stdout } = await runCli(['agent', 'parse-inbound', '--event-file', eventPath]);
    const payload = JSON.parse(stdout);

    expect(code).toBe(0);
    expect(payload.schema).toBe('feishu-auth-kit.message-context.v1');
    expect(payload.message_id).toBe('om_123');
    expect(payload.prompt_text).toBe('帮我总结今天待办');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('agent run command builds single card demo payload', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-test-'));
    const eventPath = path.join(tmpDir, 'event.json');
    fs.writeFileSync(
      eventPath,
      JSON.stringify({
        header: {
          event_id: 'evt_123',
          event_type: 'im.message.receive_v1',
          app_id: 'cli_xxx',
        },
        event: {
          sender: { sender_id: { open_id: 'ou_user' } },
          message: {
            message_id: 'om_123',
            chat_id: 'oc_123',
            message_type: 'text',
            content: '{"text":"请回复 OK"}',
          },
        },
      }),
      'utf-8',
    );

    const { code, stdout } = await runCli([
      'agent',
      'run',
      '--event-file',
      eventPath,
      '--runner',
      'echo',
      '--echo-prefix',
      'Codex stub',
    ]);
    const payload = JSON.parse(stdout);

    expect(code).toBe(0);
    expect(payload.context.prompt_text).toBe('请回复 OK');
    expect(payload.result.runner).toBe('echo');
    expect(payload.result.output_text).toBe('Codex stub: 请回复 OK');
    expect(payload.card.schema).toBe('feishu-auth-kit.cardkit.single_card.v1');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('agent run emit-events outputs jsonl', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-test-'));
    const eventPath = path.join(tmpDir, 'event.json');
    fs.writeFileSync(
      eventPath,
      JSON.stringify({
        header: { event_id: 'evt_123', event_type: 'im.message.receive_v1' },
        event: {
          sender: { sender_id: { open_id: 'ou_user' } },
          message: { message_id: 'om_123', content: '{"text":"hi"}' },
        },
      }),
      'utf-8',
    );

    const { code, stdout } = await runCli([
      'agent',
      'run',
      '--event-file',
      eventPath,
      '--runner',
      'echo',
      '--emit-events',
    ]);
    const lines = stdout.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

    expect(code).toBe(0);
    expect(lines[0].schema).toBe('feishu-auth-kit.agent-event.v1');
    expect(lines[lines.length - 1].schema).toBe('feishu-auth-kit.agent-run-summary.v1');
    expect(lines[lines.length - 1].result.runner).toBe('echo');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('agent action-to-retry cli resolves native contract', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-test-'));
    const continuationPath = path.join(tmpDir, 'continuations.json');
    const store = new FileContinuationStore(continuationPath);

    store.save(
      new AuthContinuation({
        operationId: 'op-123',
        flowKey: 'flow-123',
        appId: 'cli_xxx',
        decision: 'permission_card',
        userOpenId: 'ou_user',
        requiredScopes: ['offline_access'],
        tokenType: 'user',
        scopeNeedType: 'all',
        metadata: { session_id: 'sess-1' },
      }).toState(),
    );

    const bindRes = await runCli([
      'agent',
      'bind-continuation',
      '--operation-id',
      'op-123',
      '--text',
      '请继续之前的操作',
      '--continuation-store-path',
      continuationPath,
    ]);
    const bindPayload = JSON.parse(bindRes.stdout);

    const retryRes = await runCli([
      'agent',
      'action-to-retry',
      '--operation-id',
      'op-123',
      '--action',
      'permissions_granted_continue',
      '--actor-open-id',
      'ou_actor',
      '--continuation-store-path',
      continuationPath,
    ]);
    const retryPayload = JSON.parse(retryRes.stdout);

    expect(bindRes.code).toBe(0);
    expect(bindPayload.schema).toBe('feishu-auth-kit.native-continuation.v1');
    expect(retryRes.code).toBe(0);
    expect(retryPayload.retry_request.schema).toBe('feishu-auth-kit.native-retry-request.v1');
    expect(retryPayload.retry_request.text).toBe('请继续之前的操作');
    expect(retryPayload.retry_artifact.reason).toBe('permissions_granted_continue');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
