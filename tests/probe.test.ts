import { describe, expect, it, vi } from 'vitest';
import { FeishuAuthClient } from '../src/client.js';
import { registerAiAgent } from '../src/probe.js';

describe('probe', () => {
  it('registerAiAgent pings official openclaw bot endpoint', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn();

    // 1st call: tenant token
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        code: 0,
        tenant_access_token: 'tenant-token',
        expire: 7200,
      }),
    });

    // 2nd call: ping
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          pingBotInfo: { botID: 'ou_bot', botName: 'Test Bot' },
        },
      }),
    });

    globalThis.fetch = fetchMock;

    const client = new FeishuAuthClient('cli_xxx', 'secret');
    const result = await registerAiAgent(client);

    expect(result.ok).toBe(true);
    expect(result.app_id).toBe('cli_xxx');
    expect(result.bot_open_id).toBe('ou_bot');
    expect(result.bot_name).toBe('Test Bot');

    const [url, init] = fetchMock.mock.calls[1];
    expect(init.method).toBe('POST');
    expect(url).toBe('https://open.feishu.cn/open-apis/bot/v1/openclaw_bot/ping');
    expect(init.headers.Authorization).toBe('Bearer tenant-token');
    expect(JSON.parse(init.body)).toEqual({ needBotInfo: true });

    globalThis.fetch = originalFetch;
  });
});
