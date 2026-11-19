import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initDb, getDb } from '../../db/index.js';
import { encrypt } from '../../lib/crypto.js';
import { clearRouterPressure } from '../../services/penalty-inspector.js';
import { __quiesceAgentRuns } from '../../services/agent-runtime.js';
import {
  createAutomation,
  deleteAutomation,
  getAutomation,
  listAutomations,
  nextCronFire,
  parseCron,
  runAutomationOnce,
  tickAutomation,
  updateAutomation,
} from '../../services/automations.js';
import { listNotifications } from '../../lib/notifications.js';

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

describe('automations', () => {
  beforeEach(async () => {
    await __quiesceAgentRuns();
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    clearRouterPressure();
    addKey();
  });

  afterEach(() => {
    globalThis.fetch = fetch;
    vi.unstubAllGlobals();
  });

  it('parses cron fields and computes the next fire', () => {
    expect(parseCron('*/15 * * * *')).toHaveLength(5);
    expect(parseCron('0 9 * * 1-5')).toHaveLength(5);
    expect(parseCron('nope')).toBeNull();
    expect(parseCron('0 0 0 * *')).toBeNull();
    expect(parseCron('* * * *')).toBeNull();
    // Monday 2026-01-05 08:00 local → next 9:00 weekday fire is same day 09:00.
    const monday = new Date(2026, 0, 5, 8, 0, 0);
    const next = nextCronFire('0 9 * * 1-5', monday)!;
    expect(next.getHours()).toBe(9);
    expect(next.getDate()).toBe(5);
    // After Friday 9am the next fire is Monday.
    const friday = new Date(2026, 0, 9, 10, 0, 0);
    const following = nextCronFire('0 9 * * 1-5', friday)!;
    expect(following.getDay()).toBe(1);
    expect(following.getDate()).toBe(12);
    expect(nextCronFire('bad', monday)).toBeNull();
  });

  it('creates, updates, and deletes automations', () => {
    const id = createAutomation({ name: 'morning', goal: 'Summarize inbox', schedule: '0 9 * * *' });
    expect(getAutomation(id)).toMatchObject({ name: 'morning', reviewed: 0 });
    expect(getAutomation(id)!.next_run_at).toBeTruthy();
    expect(() => createAutomation({ name: 'morning', goal: 'x' })).toThrow('already exists');
    expect(() => createAutomation({ name: 'Bad Name!', goal: 'x' })).toThrow('Invalid automation name');
    expect(() => createAutomation({ name: 'bad', goal: 'x', schedule: 'nope' })).toThrow('Invalid cron');
    updateAutomation(id, { enabled: false });
    expect(getAutomation(id)!.enabled).toBe(0);
    expect(() => updateAutomation(99999, { enabled: true })).toThrow('not found');
    expect(listAutomations().map(a => a.name)).toEqual(['morning']);
    expect(deleteAutomation(id)).toBe(true);
    expect(deleteAutomation(id)).toBe(false);
  });

  it('runs once manually and reviews on completion with a notification', async () => {
    globalThis.fetch = vi.fn(async () => completion('briefing ready')) as unknown as typeof fetch;
    const id = createAutomation({ name: 'brief', goal: 'Write a briefing', schedule: '0 9 * * *' });
    const runId = runAutomationOnce(id);
    expect(typeof runId).toBe('number');
    // Live run: a second launch refuses to stack.
    await expect(Promise.resolve().then(() => runAutomationOnce(id))).rejects.toThrow('live run');
    for (let i = 0; i < 200; i++) {
      const run = getDb().prepare('SELECT status FROM agent_runs WHERE id = ?').get(runId) as { status: string };
      if (run.status !== 'running') break;
      await new Promise(r => setTimeout(r, 25));
    }
    tickAutomation(getAutomation(id)!);
    const automation = getAutomation(id)!;
    expect(automation.reviewed).toBe(1);
    expect(automation.last_status).toBe('done');
    const notes = listNotifications();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ kind: 'automation-done' });
    expect(notes[0].title).toContain('brief');
  });

  it('never fires an unreviewed schedule, and fires reviewed ones once due', async () => {
    globalThis.fetch = vi.fn(async () => completion('ok')) as unknown as typeof fetch;
    const id = createAutomation({ name: 'daily', goal: 'Daily digest', schedule: '* * * * *' });
    // Due (next_run_at is ~now) but unreviewed: no fire.
    getDb().prepare('UPDATE automations SET next_run_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 60_000).toISOString(), id);
    tickAutomation(getAutomation(id)!);
    expect(getAutomation(id)!.last_run_id).toBeNull();
    // Reviewed: fires, advances next_run_at, records the run.
    getDb().prepare('UPDATE automations SET reviewed = 1 WHERE id = ?').run(id);
    tickAutomation(getAutomation(id)!, new Date());
    const fired = getAutomation(id)!;
    expect(fired.last_run_id).not.toBeNull();
    expect(fired.last_status).toBe('running');
    await __quiesceAgentRuns();
  });
});
