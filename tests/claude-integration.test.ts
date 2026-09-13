import { describe, expect, it } from 'vitest';
import {
  buildClaudeDeviceFlowPayload,
  buildClaudePermissionPayload,
} from '../src/claude-adapter.js';
import { DeviceAuthorization } from '../src/models.js';

describe('claude-integration', () => {
  it('wraps generic card without runtime coupling', () => {
    const payload = buildClaudePermissionPayload({
      appId: 'cli_a1b2',
      operationId: 'op-123',
      missingScopes: ['offline_access'],
      permissionUrl: 'https://open.feishu.cn/app/cli_a1b2/auth?q=offline_access',
    });

    expect(payload.runtime).toBe('claude');
    expect(payload.schema).toBe('feishu-auth-kit.card.v1');
    expect(payload.card.type).toBe('permission_missing');
    expect(payload.instructions).not.toContain('ControlMesh');
    expect(payload.next_step.action).toBe('permissions_granted_continue');
  });

  it('wraps authorization card', () => {
    const authorization: DeviceAuthorization = {
      device_code: 'device-123',
      user_code: 'ABCD-EFGH',
      verification_uri: 'https://example.test/verify',
      verification_uri_complete: 'https://example.test/verify?code=ABCD-EFGH',
      expires_in: 600,
      interval: 5,
    };

    const payload = buildClaudeDeviceFlowPayload({
      appId: 'cli_a1b2',
      operationId: 'op-456',
      authorization,
    });

    expect(payload.runtime).toBe('claude');
    expect(payload.card.type).toBe('device_flow_authorization');
    expect(payload.card.fields.user_code).toBe('ABCD-EFGH');
    expect(payload.next_step.action).toBe('device_authorized_continue');
  });
});
