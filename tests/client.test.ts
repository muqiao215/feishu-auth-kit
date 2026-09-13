import { describe, expect, it, vi } from 'vitest';
import { FeishuAuthClient, buildPermissionUrl } from '../src/client.js';

describe('FeishuAuthClient', () => {
  it('buildPermissionUrl includes scope, token type and source', () => {
    const url = buildPermissionUrl('cli_a1b2', {
      scopes: ['offline_access', 'im:message:readonly'],
      brand: 'feishu',
      tokenType: 'user',
      opFrom: 'feishu-auth-kit',
    });

    expect(url.startsWith('https://open.feishu.cn/app/cli_a1b2/auth?')).toBe(true);
    expect(url).toContain('q=offline_access%2Cim%3Amessage%3Areadonly');
    expect(url).toContain('token_type=user');
    expect(url).toContain('op_from=feishu-auth-kit');
  });

  it('getAppInfo parses scopes and token types', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn();

    // 1st call: tenant_access_token
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        code: 0,
        tenant_access_token: 'tenant-token',
        expire: 7200,
      }),
    });

    // 2nd call: app info
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          app: {
            app_id: 'cli_a1b2',
            creator_id: 'ou_creator',
            owner: { owner_id: 'ou_owner', owner_type: 2 },
            scopes: [
              {
                scope: 'im:message:readonly',
                token_types: ['user'],
              },
              {
                scope: 'application:application:self_manage',
                token_types: ['tenant'],
              },
            ],
          },
        },
      }),
    });

    globalThis.fetch = fetchMock;

    const client = new FeishuAuthClient('cli_a1b2', 'secret');
    const appInfo = await client.getAppInfo();

    expect(appInfo.app_id).toBe('cli_a1b2');
    expect(appInfo.creator_id).toBe('ou_creator');
    expect(appInfo.owner_open_id).toBe('ou_owner');
    expect(appInfo.effective_owner_open_id).toBe('ou_owner');
    expect(appInfo.scopes[0].token_types).toEqual(['user']);

    const userScopes = await client.getGrantedScopes({ tokenType: 'user' });
    const tenantScopes = await client.getGrantedScopes({ tokenType: 'tenant' });

    expect(userScopes).toEqual(['im:message:readonly']);
    expect(tenantScopes).toEqual(['application:application:self_manage']);

    globalThis.fetch = originalFetch;
  });
});
