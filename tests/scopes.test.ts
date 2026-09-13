import { describe, expect, it } from 'vitest';
import {
  CORE_APP_SCOPES,
  batchScopes,
  filterSensitiveScopes,
  summarizeScopeBatches,
} from '../src/scopes.js';

describe('scopes', () => {
  it('filterSensitiveScopes removes high risk items', () => {
    const scopes = [
      'im:message:readonly',
      'im:message.send_as_user',
      'space:document:delete',
      'offline_access',
    ];

    const filtered = filterSensitiveScopes(scopes);
    expect(filtered).toEqual(['im:message:readonly', 'offline_access']);
  });

  it('batchScopes splits in stable chunks', () => {
    const scopes = Array.from({ length: 7 }, (_, i) => `scope:${i}`);

    const batches = batchScopes(scopes, 3);
    expect(batches).toEqual([
      ['scope:0', 'scope:1', 'scope:2'],
      ['scope:3', 'scope:4', 'scope:5'],
      ['scope:6'],
    ]);
  });

  it('summarizeScopeBatches reports counts', () => {
    const summary = summarizeScopeBatches([['a', 'b'], ['c']]);
    expect(summary).toEqual(['Batch 1: 2 scopes', 'Batch 2: 1 scopes']);
    expect(CORE_APP_SCOPES).toContain('application:application:self_manage');
  });
});
