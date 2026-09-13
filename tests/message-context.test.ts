import { describe, expect, it } from 'vitest';
import { parseFeishuMessageContext } from '../src/message-context.js';

describe('message-context', () => {
  it('extracts native fields', () => {
    const context = parseFeishuMessageContext({
      schema: '2.0',
      header: {
        event_id: 'evt_123',
        event_type: 'im.message.receive_v1',
        app_id: 'cli_xxx',
        tenant_key: 'tenant_123',
      },
      event: {
        sender: {
          sender_id: {
            open_id: 'ou_user',
            user_id: 'u_user',
          },
        },
        message: {
          message_id: 'om_123',
          chat_id: 'oc_123',
          chat_type: 'p2p',
          message_type: 'text',
          content: '{"text":"@_user_1 帮我总结今天待办"}',
          mentions: [
            {
              key: '@_user_1',
              name: 'bot',
              id: { open_id: 'ou_bot' },
            },
          ],
        },
      },
    });

    expect(context.schema).toBe('feishu-auth-kit.message-context.v1');
    expect(context.event_type).toBe('im.message.receive_v1');
    expect(context.app_id).toBe('cli_xxx');
    expect(context.tenant_key).toBe('tenant_123');
    expect(context.message_id).toBe('om_123');
    expect(context.chat_id).toBe('oc_123');
    expect(context.sender_open_id).toBe('ou_user');
    expect(context.text).toBe('@_user_1 帮我总结今天待办');
    expect(context.promptText()).toBe('帮我总结今天待办');
    expect(context.mentions[0].open_id).toBe('ou_bot');
  });
});
