import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  NativeCardAction,
  NativeContinuationRecord,
  buildRetryArtifactFromRequest,
  resolveCardActionToRetry,
  saveNativeContinuation,
} from '../src/native-contract.js';
import { AuthContinuation } from '../src/orchestration.js';
import { FileContinuationStore } from '../src/runtime-cards.js';

describe('native-contract', () => {
  it('resolves card action to retry request', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-test-'));
    const store = new FileContinuationStore(path.join(tmpDir, 'continuations.json'));

    const continuation = NativeContinuationRecord.fromAuthContinuation(
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
      }),
      { retryText: '请继续之前的操作' },
    );
    saveNativeContinuation(store, continuation);

    const resolved = resolveCardActionToRetry(
      new NativeCardAction({
        operationId: 'op-123',
        action: 'permissions_granted_continue',
        actorOpenId: 'ou_actor',
      }),
      store,
    );

    expect(resolved.continuation.status).toBe('confirmed');
    expect(resolved.retryRequest.text).toBe('请继续之前的操作');
    expect(resolved.retryRequest.actorOpenId).toBe('ou_actor');
    expect(resolved.retryRequest.userOpenId).toBe('ou_user');
    expect(resolved.retryRequest.metadata.session_id).toBe('sess-1');

    const artifact = buildRetryArtifactFromRequest(resolved.retryRequest);
    expect(artifact.kind).toBe('synthetic_retry');
    expect(artifact.reason).toBe('permissions_granted_continue');
    expect(artifact.metadata.actor_open_id).toBe('ou_actor');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
