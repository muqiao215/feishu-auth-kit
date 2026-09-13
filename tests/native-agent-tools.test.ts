import { describe, expect, it } from 'vitest';
import {
  buildNativeAgentToolSelectionPrompt,
  buildToolResultFollowupPrompt,
  getNativeAgentToolSpec,
  nativeAgentToolSpecs,
  nativeUserAuthScopes,
  parseNativeAgentToolSelection,
} from '../src/native-agent-tools.js';

describe('native-agent-tools', () => {
  it('nativeAgentToolSpecs includes contact.search_user', () => {
    const specs = Object.fromEntries(nativeAgentToolSpecs().map((s) => [s.name, s]));
    expect(specs['contact.search_user']).toBeDefined();
    expect(specs['contact.search_user'].parameters.query).toBe('string');
    expect(specs['contact.search_user'].required_scopes).toEqual(['contact:user:search']);
  });

  it('getNativeAgentToolSpec returns known tool', () => {
    const spec = getNativeAgentToolSpec('im.get_messages');
    expect(spec).not.toBeNull();
    expect(spec?.required_scopes).toContain('im:message:readonly');
  });

  it('nativeUserAuthScopes dedupes all required scopes', () => {
    const scopes = nativeUserAuthScopes();
    expect(scopes[0]).toBe('offline_access');
    expect(scopes).toContain('contact:user:search');
    expect(scopes).toContain('space:document:retrieve');
  });

  it('parseNativeAgentToolSelection accepts known tool', () => {
    const selection = parseNativeAgentToolSelection(
      '{"tool_name":"contact.search_user","arguments":{"query":"Alice"}}',
    );
    expect(selection).not.toBeNull();
    expect(selection?.tool_name).toBe('contact.search_user');
    expect(selection?.arguments).toEqual({ query: 'Alice' });
  });

  it('parseNativeAgentToolSelection rejects none and unknown', () => {
    expect(parseNativeAgentToolSelection('{"tool_name":"none","arguments":{}}')).toBeNull();
    expect(parseNativeAgentToolSelection('{"tool_name":"unknown","arguments":{}}')).toBeNull();
  });

  it('buildNativeAgentToolSelectionPrompt includes context', () => {
    const prompt = buildNativeAgentToolSelectionPrompt({
      userText: '帮我找 Alice',
      inboundContext: { chat_id: 'oc_123', sender_open_id: 'ou_123' },
    });
    expect(prompt).toContain('Feishu native tool selector');
    expect(prompt).toContain('contact.search_user');
    expect(prompt).toContain('"chat_id": "oc_123"');
    expect(prompt).toContain('帮我找 Alice');
  });

  it('buildToolResultFollowupPrompt includes result', () => {
    const prompt = buildToolResultFollowupPrompt({
      originalText: '帮我找 Alice',
      toolName: 'contact.search_user',
      arguments: { query: 'Alice' },
      result: { users: [{ name: 'Alice' }] },
    });
    expect(prompt).toContain('帮我找 Alice');
    expect(prompt).toContain('contact.search_user');
    expect(prompt).toContain('"Alice"');
    expect(prompt).toContain('Do not emit another Feishu native tool selection JSON.');
  });
});
