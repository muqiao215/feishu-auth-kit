import { describe, expect, it, vi } from 'vitest';
import {
  AppRegistrationClient,
  AppRegistrationError,
} from '../src/app-registration.js';

describe('AppRegistrationClient', () => {
  it('init requires client_secret auth method', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        nonce: 'nonce-1',
        supported_auth_methods: ['jwt'],
      }),
    } as any);

    const client = new AppRegistrationClient();
    await expect(client.init()).rejects.toThrow(AppRegistrationError);

    globalThis.fetch = originalFetch;
  });

  it('begin posts official registration body and adds qr params', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        device_code: 'dev-123',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://accounts.feishu.cn/verify',
        verification_uri_complete: 'https://accounts.feishu.cn/verify?device_code=dev-123',
        interval: 3,
        expire_in: 600,
      }),
    });

    globalThis.fetch = fetchMock;

    const client = new AppRegistrationClient({ brand: 'feishu' });
    const result = await client.begin();

    const [url, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(url).toBe('https://accounts.feishu.cn/oauth/v1/app/registration');
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');

    const qrUrl = new URL(result.qr_url);
    expect(qrUrl.searchParams.get('device_code')).toBe('dev-123');
    expect(qrUrl.searchParams.get('from')).toBe('oc_onboard');
    expect(qrUrl.searchParams.get('tp')).toBe('ob_cli_app');
    expect(result.interval).toBe(3);
    expect(result.expires_in).toBe(600);

    globalThis.fetch = originalFetch;
  });

  it('poll handles pending, slow_down, and success', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn();

    // 1: authorization_pending
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ error: 'authorization_pending' }),
    });

    // 2: slow_down
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ error: 'slow_down' }),
    });

    // 3: success
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        client_id: 'cli_new',
        client_secret: 'secret-new',
        user_info: { open_id: 'ou_owner', tenant_brand: 'feishu' },
      }),
    });

    globalThis.fetch = fetchMock;

    const client = new AppRegistrationClient();
    const outcome = await client.poll('dev-123', {
      interval: 0.01,
      expiresIn: 10,
      sleeper: async () => {},
    });

    expect(outcome.status).toBe('success');
    expect(outcome.result?.app_id).toBe('cli_new');
    expect(outcome.result?.app_secret).toBe('secret-new');
    expect(outcome.result?.open_id).toBe('ou_owner');

    globalThis.fetch = originalFetch;
  });
});
