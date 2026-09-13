import { describe, expect, it, vi } from 'vitest';
import { DeviceFlowClient } from '../src/device-flow.js';

describe('DeviceFlowClient', () => {
  it('requestAuthorization uses form body and adds offline_access', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        device_code: 'dev-123',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://example.test/verify',
        verification_uri_complete: 'https://example.test/verify?code=ABCD-EFGH',
        expires_in: 600,
        interval: 5,
      }),
    });

    globalThis.fetch = fetchMock;

    const client = new DeviceFlowClient('cli_a1b2', 'secret');
    const auth = await client.requestAuthorization(['im:message:readonly']);

    expect(auth.device_code).toBe('dev-123');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');

    const bodyStr = init.body.toString();
    expect(bodyStr).toContain('client_id=cli_a1b2');
    expect(bodyStr).toContain('scope=im%3Amessage%3Areadonly+offline_access');

    globalThis.fetch = originalFetch;
  });
});
