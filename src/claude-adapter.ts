import { DeviceAuthorization } from './models.js';
import {
  buildDeviceFlowCard,
  buildPermissionMissingCard,
} from './runtime-cards.js';

function wrapForClaude(card: Record<string, any>, action: string): Record<string, any> {
  return {
    runtime: 'claude',
    schema: 'feishu-auth-kit.card.v1',
    card,
    instructions:
      'Render or relay this JSON payload to the user, then send the action payload ' +
      'back to feishu-auth-kit when the user confirms they completed the step.',
    next_step: {
      action,
      operation_id: card.operation_id,
      payload_schema: {
        operation_id: 'string',
        actor_open_id: 'string_optional',
      },
    },
  };
}

export function buildClaudePermissionPayload(options: {
  appId: string;
  operationId: string;
  missingScopes: string[];
  permissionUrl: string;
  userOpenId?: string | null;
}): Record<string, any> {
  const card = buildPermissionMissingCard(options);
  return wrapForClaude(card.toDict(), 'permissions_granted_continue');
}

export function buildClaudeDeviceFlowPayload(options: {
  appId: string;
  operationId: string;
  authorization: DeviceAuthorization;
}): Record<string, any> {
  const card = buildDeviceFlowCard(options);
  return wrapForClaude(card.toDict(), 'device_authorized_continue');
}
