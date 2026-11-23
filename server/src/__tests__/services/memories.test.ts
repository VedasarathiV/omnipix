import { beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../../db/index.js';
import {
  deleteMemory,
  getMemory,
  listMemories,
  memoryPromptSection,
  memoryScore,
  recallForRun,
  rememberMemory,
} from '../../services/memories.js';

describe('memories', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
  });

  it('stores user and project memories with redaction', () => {
    const { id, redactions } = rememberMemory({ key: 'contact', value: 'mail bob@example.com' });
    expect(redactions).toBe(1);
    expect(getMemory(id)).toMatchObject({ scope: 'user', key: 'contact' });
    expect(getMemory(id)!.value).not.toContain('bob@example.com');
    // Upsert on the same triple keeps one row.
    rememberMemory({ key: 'contact', value: 'use signal' });
    expect(listMemories('user')).toHaveLength(1);
    rememberMemory({ scope: 'project', projectKey: 'shop', key: 'stack', value: 'go + htmx' });
    expect(listMemories('project', 'shop').map(m => m.key)).toEqual(['stack']);
    expect(listMemories('project', 'other')).toEqual([]);
    expect(() => rememberMemory({ scope: 'project', key: 'k', value: 'v' })).toThrow('project key');
    expect(() => rememberMemory({ key: '  ', value: 'v' })).toThrow('non-empty');
  });

  it('scores decay by age and rewards use', () => {
    const base = {
      id: 1, scope: 'user', project_key: '', key: 'k', value: 'v', importance: 0.5,
      source: 'user', run_id: null, use_count: 0, created_at: '', updated_at: '',
      last_used_at: null as string | null,
    };
    const now = Date.parse('2026-06-01T00:00:00Z');
    const fresh = memoryScore({ ...base, updated_at: '2026-06-01T00:00:00Z' }, now);
    const old = memoryScore({ ...base, updated_at: '2026-01-01T00:00:00Z' }, now);
    expect(fresh).toBeGreaterThan(old);
    const used = memoryScore({ ...base, updated_at: '2026-01-01T00:00:00Z', use_count: 10 }, now);
    expect(used).toBeGreaterThan(old);
    expect(memoryScore({ ...base, importance: 0, updated_at: '2020-01-01T00:00:00Z' }, now)).toBe(0);
  });

  it('recalls top memories for a run and bumps usage', () => {
    rememberMemory({ key: 'style', value: 'tabs' });
    rememberMemory({ scope: 'project', projectKey: 'shop', key: 'stack', value: 'go' });
    rememberMemory({ scope: 'project', projectKey: 'other', key: 'nope', value: 'x' });
    rememberMemory({ key: 'zero', value: 'never', importance: 0 });
    // Age the zero-importance row out of contention is unnecessary: score 0
    // is below the floor on its own.
    const recalled = recallForRun('shop', 5);
    expect(recalled.map(m => m.key).sort()).toEqual(['stack', 'style']);
    expect(getMemory(recalled[0].id)!.use_count).toBe(1);
    const section = memoryPromptSection(recalled);
    expect(section).toContain('[user] style: tabs');
    expect(section).toContain('[project:shop] stack: go');
    expect(memoryPromptSection([])).toBe('');
  });

  it('deletes memories', () => {
    const { id } = rememberMemory({ key: 'temp', value: 'x' });
    expect(deleteMemory(id)).toBe(true);
    expect(deleteMemory(id)).toBe(false);
    expect(getMemory(id)).toBeNull();
  });
});
