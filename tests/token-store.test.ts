import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DeviceToken } from '../src/models.js';
import { FileTokenStore, StoredUserToken } from '../src/token-store.js';

describe('FileTokenStore', () => {
  it('saves, loads, status, and removes user token', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-test-'));
    const storePath = path.join(tmpDir, 'tokens.json');
    const store = new FileTokenStore(storePath);

    const token: StoredUserToken = {
      app_id: 'cli_a1b2',
      user_open_id: 'ou_user',
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_at: 1800,
      refresh_expires_at: 3600,
      scope: 'im:message:readonly offline_access',
    };

    store.save(token);

    const loaded = store.load('cli_a1b2', 'ou_user');
    const status = store.status('cli_a1b2', 'ou_user');
    expect(loaded).toEqual(token);
    expect(status.exists).toBe(true);
    expect(status.app_id).toBe('cli_a1b2');
    expect(status.user_open_id).toBe('ou_user');
    expect(status.scope).toBe('im:message:readonly offline_access');
    expect(status.storage_path).toBe(storePath);

    expect(store.remove('cli_a1b2', 'ou_user')).toBe(true);
    expect(store.load('cli_a1b2', 'ou_user')).toBeNull();
    expect(store.status('cli_a1b2', 'ou_user').exists).toBe(false);
    expect(store.remove('cli_a1b2', 'ou_user')).toBe(false);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('can save device token with relative expiry', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-test-'));
    const storePath = path.join(tmpDir, 'tokens.json');
    const store = new FileTokenStore(storePath);

    const deviceToken: DeviceToken = {
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_in: 600,
      refresh_expires_in: 1200,
      scope: 'offline_access',
    };

    const stored = store.saveDeviceToken('cli_a1b2', 'ou_user', deviceToken, 1000);

    expect(stored.expires_at).toBe(1600);
    expect(stored.refresh_expires_at).toBe(2200);
    expect(store.load('cli_a1b2', 'ou_user')).toEqual(stored);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
