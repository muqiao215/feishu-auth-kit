import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DeviceAuthorization } from '../src/models.js';
import {
  CardAction,
  ContinuationState,
  FileContinuationStore,
  buildDeviceFlowCard,
  buildPermissionMissingCard,
  processCardAction,
} from '../src/runtime-cards.js';

describe('runtime-cards', () => {
  it('permission missing card contains action payload and permission url', () => {
    const card = buildPermissionMissingCard({
      appId: 'cli_a1b2',
      operationId: 'op-123',
      missingScopes: ['application:application:self_manage'],
      permissionUrl: 'https://open.feishu.cn/app/cli_a1b2/auth?q=x',
      userOpenId: 'ou_user',
    });

    const body = card.toDict();
    expect(body.type).toBe('permission_missing');
    expect(body.operation_id).toBe('op-123');
    expect(body.actions[0].action).toBe('permissions_granted_continue');
    expect(body.actions[0].payload.operation_id).toBe('op-123');
    expect(body.links[0].url).toBe('https://open.feishu.cn/app/cli_a1b2/auth?q=x');
  });

  it('device flow card contains authorization url user code and continue action', () => {
    const authorization: DeviceAuthorization = {
      device_code: 'device-123',
      user_code: 'ABCD-EFGH',
      verification_uri: 'https://example.test/verify',
      verification_uri_complete: 'https://example.test/verify?code=ABCD-EFGH',
      expires_in: 600,
      interval: 5,
    };

    const card = buildDeviceFlowCard({
      appId: 'cli_a1b2',
      operationId: 'op-456',
      authorization,
    });

    const body = card.toDict();
    expect(body.type).toBe('device_flow_authorization');
    expect(body.fields.user_code).toBe('ABCD-EFGH');
    expect(body.fields.device_code).toBe('device-123');
    expect(body.actions[0].action).toBe('device_authorized_continue');
    expect(body.actions[0].payload.operation_id).toBe('op-456');
  });

  it('file continuation store and action processing round trip', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'continuation-test-'));
    const storePath = path.join(tmpDir, 'continuations.json');
    const store = new FileContinuationStore(storePath);

    const state: ContinuationState = {
      operationId: 'op-123',
      appId: 'cli_a1b2',
      kind: 'permission_missing',
      status: 'waiting',
      payload: { missing_scopes: ['offline_access'] },
    };
    store.save(state);

    const loaded = store.load('op-123');
    const result = processCardAction(
      new CardAction({
        action: 'permissions_granted_continue',
        payload: { operation_id: 'op-123', actor_open_id: 'ou_user' },
      }),
      store,
    );

    expect(loaded).toEqual(state);
    expect(result.operationId).toBe('op-123');
    expect(result.status).toBe('confirmed');
    expect(result.payload.actor_open_id).toBe('ou_user');
    expect(store.load('op-123')?.status).toBe('confirmed');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
