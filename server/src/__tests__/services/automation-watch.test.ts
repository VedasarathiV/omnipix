import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDb, getDb } from '../../db/index.js';
import { encrypt } from '../../lib/crypto.js';
import { __quiesceAgentRuns } from '../../services/agent-runtime.js';
import {
  createAutomation,
  getAutomation,
  normalizeWatchPaths,
  parseWatchJson,
  updateAutomation,
} from '../../services/automations.js';
import {
  refreshAutomationWatchers,
  stopAutomationWatchersForTests,
  watchedAutomationCountForTests,
} from '../../services/automation-watch.js';

function addKey(): void {
  const { encrypted, iv, authTag } = encrypt('groq-key');
  getDb().prepare(
    "INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled) VALUES ('groq', 'test', ?, ?, ?, 'healthy', 1)",
  ).run(encrypted, iv, authTag);
}

function completion(content: string) {
  return new Response(JSON.stringify({
    id: 'x', object: 'chat.completion', created: 1, model: 'llama-3.1-8b-instant',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('automation file-watch triggers', () => {
  let dir = '';

  beforeEach(async () => {
    await __quiesceAgentRuns();
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    addKey();
    dir = mkdtempSync(join(tmpdir(), 'omnipix-watch-'));
    writeFileSync(join(dir, 'seed.txt'), 'seed');
  });

  afterEach(() => {
    stopAutomationWatchersForTests();
    globalThis.fetch = fetch;
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });

  it('normalizes watch paths and rejects bad ones', () => {
    expect(normalizeWatchPaths([dir, dir])).toEqual([dir]);
    expect(() => normalizeWatchPaths('nope')).toThrow('must be an array');
    expect(() => normalizeWatchPaths(['relative/path'])).toThrow('must be absolute');
    expect(() => normalizeWatchPaths([join(dir, 'missing.txt')])).toThrow('does not exist');
    expect(() => normalizeWatchPaths(['  '])).toThrow('non-empty');
    expect(() => normalizeWatchPaths(new Array(11).fill(dir))).toThrow('at most 10');
  });

  it('parses watch_json defensively', () => {
    expect(parseWatchJson(null)).toEqual([]);
    expect(parseWatchJson('')).toEqual([]);
    expect(parseWatchJson('not json')).toEqual([]);
    expect(parseWatchJson('{"a":1}')).toEqual([]);
    expect(parseWatchJson(JSON.stringify([dir, 42]))).toEqual([dir]);
  });

  it('persists watch lists through create and update', () => {
    const id = createAutomation({ name: 'watcher', goal: 'React to changes', watch: [dir] });
    expect(parseWatchJson(getAutomation(id)!.watch_json)).toEqual([dir]);
    updateAutomation(id, { watch: [] });
    expect(parseWatchJson(getAutomation(id)!.watch_json)).toEqual([]);
    expect(() => createAutomation({ name: 'bad', goal: 'x', watch: ['relative'] })).toThrow('absolute');
  });

  it('fires a reviewed automation when a watched file changes', async () => {
    globalThis.fetch = vi.fn(async () => completion('watched change handled')) as unknown as typeof fetch;
    const id = createAutomation({ name: 'watchfire', goal: 'Handle the change', watch: [dir] });
    getDb().prepare('UPDATE automations SET reviewed = 1 WHERE id = ?').run(id);
    refreshAutomationWatchers();
    expect(watchedAutomationCountForTests()).toBe(1);
    writeFileSync(join(dir, 'trigger.txt'), 'changed');
    let fired = false;
    for (let i = 0; i < 120; i++) {
      if (getAutomation(id)!.last_run_id != null) { fired = true; break; }
      await new Promise(r => setTimeout(r, 50));
    }
    expect(fired).toBe(true);
  }, 15000);

  it('never fires an unreviewed automation on file change', async () => {
    const id = createAutomation({ name: 'unreviewed', goal: 'Stay quiet', watch: [dir] });
    refreshAutomationWatchers();
    writeFileSync(join(dir, 'trigger.txt'), 'changed');
    await new Promise(r => setTimeout(r, 2600));
    expect(getAutomation(id)!.last_run_id).toBeNull();
  }, 15000);
});
