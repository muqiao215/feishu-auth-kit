import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DeviceAuthorization } from '../src/models.js';
import {
  AuthContinuation,
  AuthRequirement,
  FilePendingFlowRegistry,
  buildSyntheticRetryArtifact,
  loadAuthContinuation,
  planScopeAuthorization,
  routeAuthRequirement,
  saveAuthContinuation,
  verifyAccessTokenIdentity,
} from '../src/orchestration.js';
import { FileContinuationStore } from '../src/runtime-cards.js';

describe('orchestration', () => {
  it('pending flow registry reuses operation id and merges scopes', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-test-'));
    const registry = new FilePendingFlowRegistry(path.join(tmpDir, 'pending.json'));
    const continuationStore = new FileContinuationStore(path.join(tmpDir, 'continuations.json'));

    const first = routeAuthRequirement({
      appId: 'cli_xxx',
      requirement: new AuthRequirement({
        errorKind: 'app_scope_missing',
        requiredScopes: ['offline_access'],
        userOpenId: 'ou_user',
        flowKey: 'flow-1',
      }),
      pendingFlows: registry,
      continuationStore,
      permissionUrl: 'https://open.feishu.cn/app/cli_xxx/auth?q=offline_access',
    });

    const second = routeAuthRequirement({
      appId: 'cli_xxx',
      requirement: new AuthRequirement({
        errorKind: 'app_scope_missing',
        requiredScopes: ['im:message:readonly', 'offline_access'],
        userOpenId: 'ou_user',
        flowKey: 'flow-1',
      }),
      pendingFlows: registry,
      continuationStore,
      permissionUrl: 'https://open.feishu.cn/app/cli_xxx/auth?q=offline_access',
    });

    expect(first.reusedExistingFlow).toBe(false);
    expect(second.reusedExistingFlow).toBe(true);
    expect(first.flow.operationId).toBe(second.flow.operationId);
    expect(second.flow.requiredScopes).toEqual(['offline_access', 'im:message:readonly']);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('scope authorization plan reports missing unavailable and batches', () => {
    const plan = planScopeAuthorization({
      requestedScopes: [
        'offline_access',
        'im:message:readonly',
        'calendar:calendar.event:delete',
        'contact:contact.base:readonly',
      ],
      appGrantedScopes: [
        'offline_access',
        'im:message:readonly',
        'contact:contact.base:readonly',
      ],
      userGrantedScopes: ['offline_access'],
      batchSize: 1,
    });

    expect(plan.alreadyGrantedScopes).toEqual(['offline_access']);
    expect(plan.missingUserScopes).toEqual([
      'im:message:readonly',
      'contact:contact.base:readonly',
    ]);
    expect(plan.unavailableScopes).toEqual([]);
    expect(plan.batches).toEqual([['im:message:readonly'], ['contact:contact.base:readonly']]);
  });

  it('app scope missing routes to permission card', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-test-'));
    const result = routeAuthRequirement({
      appId: 'cli_xxx',
      requirement: new AuthRequirement({
        errorKind: 'app_scope_missing',
        requiredScopes: ['application:application:self_manage'],
        userOpenId: 'ou_user',
        flowKey: 'flow-perm',
      }),
      pendingFlows: new FilePendingFlowRegistry(path.join(tmpDir, 'pending.json')),
      continuationStore: new FileContinuationStore(path.join(tmpDir, 'continuations.json')),
      permissionUrl: 'https://open.feishu.cn/app/cli_xxx/auth?q=application:application:self_manage',
    });

    expect(result.decision).toBe('permission_card');
    expect(result.card).not.toBeNull();
    expect(result.card?.toDict().type).toBe('permission_missing');
    expect(result.card?.toDict().actions[0].action).toBe('permissions_granted_continue');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('user auth required routes to device flow card', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-test-'));
    const result = routeAuthRequirement({
      appId: 'cli_xxx',
      requirement: new AuthRequirement({
        errorKind: 'user_auth_required',
        requiredScopes: ['offline_access', 'im:message:readonly'],
        userOpenId: 'ou_user',
        flowKey: 'flow-device',
      }),
      pendingFlows: new FilePendingFlowRegistry(path.join(tmpDir, 'pending.json')),
      continuationStore: new FileContinuationStore(path.join(tmpDir, 'continuations.json')),
      authorization: {
        device_code: 'device-123',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://example.test/verify',
        verification_uri_complete: 'https://example.test/verify?code=ABCD-EFGH',
        expires_in: 600,
        interval: 5,
      },
    });

    expect(result.decision).toBe('device_flow');
    expect(result.card).not.toBeNull();
    expect(result.card?.toDict().type).toBe('device_flow_authorization');
    expect(result.card?.toDict().fields.user_code).toBe('ABCD-EFGH');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('synthetic retry artifact contains host consumable fields', () => {
    const artifact = buildSyntheticRetryArtifact({
      operationId: 'op-123',
      appId: 'cli_xxx',
      userOpenId: 'ou_user',
      text: '请继续之前的操作',
      reason: 'auth_completed',
      metadata: { session_id: 'sess-1' },
    });

    expect(artifact.schema).toBe('feishu-auth-kit.synthetic-retry.v1');
    expect(artifact.kind).toBe('synthetic_retry');
    expect(artifact.metadata.session_id).toBe('sess-1');
  });

  it('auth continuation round trip', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-test-'));
    const store = new FileContinuationStore(path.join(tmpDir, 'continuations.json'));
    const continuation = new AuthContinuation({
      operationId: 'op-123',
      flowKey: 'flow-123',
      appId: 'cli_xxx',
      decision: 'device_flow',
      userOpenId: 'ou_user',
      requiredScopes: ['offline_access', 'im:message:readonly'],
      tokenType: 'user',
      scopeNeedType: 'all',
      metadata: { message_id: 'msg-1' },
    });

    saveAuthContinuation(store, continuation);
    const loaded = loadAuthContinuation(store, 'op-123');

    expect(loaded).toEqual(continuation);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('verify access token identity uses open id from response', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, data: { open_id: 'ou_user' } }),
    } as any);

    const result = await verifyAccessTokenIdentity({
      accessToken: 'access-token',
      expectedOpenId: 'ou_user',
    });

    expect(result.valid).toBe(true);
    expect(result.actualOpenId).toBe('ou_user');

    globalThis.fetch = originalFetch;
  });

  it('saved continuation file contains rich payload', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-test-'));
    const storePath = path.join(tmpDir, 'continuations.json');
    const store = new FileContinuationStore(storePath);
    const continuation = new AuthContinuation({
      operationId: 'op-123',
      flowKey: 'flow-123',
      appId: 'cli_xxx',
      decision: 'permission_card',
      userOpenId: 'ou_user',
      requiredScopes: ['application:application:self_manage'],
      tokenType: 'tenant',
      scopeNeedType: 'one',
      metadata: { tool: 'calendar' },
    });
    saveAuthContinuation(store, continuation);

    const payload = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
    const saved = payload.continuations['op-123'].payload;
    expect(saved.flow_key).toBe('flow-123');
    expect(saved.token_type).toBe('tenant');
    expect(saved.scope_need_type).toBe('one');
    expect(saved.metadata.tool).toBe('calendar');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
