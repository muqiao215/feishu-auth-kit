import { describe, expect, it } from 'vitest';
import { AppInfo } from '../src/models.js';
import {
  OwnerPolicyError,
  OwnerPolicyMode,
  assertOwnerPolicy,
  checkOwnerPolicy,
} from '../src/owner-policy.js';

class FakeClient {
  readonly appInfo: AppInfo;
  readonly calls: string[] = [];

  constructor(appInfo: AppInfo) {
    this.appInfo = appInfo;
  }

  async getAppInfo(appId: string = 'me'): Promise<AppInfo> {
    this.calls.push(appId);
    return this.appInfo;
  }
}

describe('owner-policy', () => {
  it('allows effective owner from existing app info', async () => {
    const appInfo: AppInfo = {
      app_id: 'cli_a1b2',
      owner_open_id: 'ou_owner',
      effective_owner_open_id: 'ou_owner',
    };

    const result = await checkOwnerPolicy(appInfo, {
      currentUserOpenId: 'ou_owner',
    });

    expect(result.allowed).toBe(true);
    expect(result.owner_open_id).toBe('ou_owner');
    expect(result.current_user_open_id).toBe('ou_owner');
    expect(result.mode).toBe(OwnerPolicyMode.STRICT_OWNER);
  });

  it('rejects non-owner in strict mode', async () => {
    const appInfo: AppInfo = {
      app_id: 'cli_a1b2',
      owner_open_id: 'ou_owner',
      effective_owner_open_id: 'ou_owner',
    };

    const result = await checkOwnerPolicy(appInfo, {
      currentUserOpenId: 'ou_other',
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('ou_owner');
    await expect(
      assertOwnerPolicy(appInfo, { currentUserOpenId: 'ou_other' }),
    ).rejects.toThrow(OwnerPolicyError);
  });

  it('can fetch app info from client without duplicate http logic', async () => {
    const client = new FakeClient({
      app_id: 'cli_a1b2',
      creator_id: 'ou_creator',
      effective_owner_open_id: 'ou_creator',
    });

    const result = await checkOwnerPolicy(client as any, {
      currentUserOpenId: 'ou_other',
      mode: OwnerPolicyMode.PERMISSIVE_IF_UNKNOWN,
      appId: 'me',
    });

    expect(client.calls).toEqual(['me']);
    expect(result.allowed).toBe(false);
    expect(result.owner_open_id).toBe('ou_creator');
  });

  it('permissive mode allows missing owner metadata', async () => {
    const appInfo: AppInfo = { app_id: 'cli_a1b2' };

    const result = await checkOwnerPolicy(appInfo, {
      currentUserOpenId: 'ou_user',
      mode: OwnerPolicyMode.PERMISSIVE_IF_UNKNOWN,
    });

    expect(result.allowed).toBe(true);
    expect(result.reason).toContain('metadata unavailable');
  });
});
