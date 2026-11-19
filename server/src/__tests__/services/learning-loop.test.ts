import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initDb, getDb } from '../../db/index.js';
import { encrypt } from '../../lib/crypto.js';
import {
  learnFromRun,
  listProposals,
  resolveProposal,
  searchRuns,
} from '../../services/learning-loop.js';

const nativeFetch = globalThis.fetch.bind(globalThis);

function seedKey(): void {
  const { encrypted, iv, authTag } = encrypt('groq-key');
  getDb().prepare(
    "INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled) VALUES ('groq', 'test', ?, ?, ?, 'healthy', 1)",
  ).run(encrypted, iv, authTag);
}

function seedRun(): number {
  const row = getDb().prepare(
    `INSERT INTO agent_runs (goal, model, tools_json, skills_json, status, steps_used, final_answer, project_key)
     VALUES ('Do the thing', 'auto', '[]', '[]', 'done', 8, 'finished', '') RETURNING id`,
  ).get() as { id: number };
  return row.id;
}

function toolSteps(runId: number, tools: string[]): void {
  const insert = getDb().prepare(
    'INSERT INTO agent_steps (run_id, seq, kind, name, content_json) VALUES (?, ?, ?, ?, ?)',
  );
  let seq = 0;
  for (const tool of tools) {
    seq++;
    insert.run(runId, seq, 'tool_call', tool, JSON.stringify({ arguments: {} }));
    seq++;
    insert.run(runId, seq, 'tool_result', tool, JSON.stringify({ result: 'ok' }));
  }
}

function errorSteps(runId: number, tool: string, error: string, count: number): void {
  const insert = getDb().prepare(
    'INSERT INTO agent_steps (run_id, seq, kind, name, content_json) VALUES (?, ?, ?, ?, ?)',
  );
  let seq = 0;
  for (let i = 0; i < count; i++) {
    seq++;
    insert.run(runId, seq, 'tool_call', tool, JSON.stringify({ arguments: {} }));
    seq++;
    insert.run(runId, seq, 'tool_result', tool, JSON.stringify({ result: `tool error: ${error}` }));
  }
}

function skillCompletion(payload: unknown) {
  return new Response(JSON.stringify({
    id: 'x', object: 'chat.completion', created: 1, model: 'llama-3.1-8b-instant',
    choices: [{ index: 0, message: { role: 'assistant', content: typeof payload === 'string' ? payload : JSON.stringify(payload) }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('learning loop', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    seedKey();
  });

  afterEach(() => {
    globalThis.fetch = nativeFetch;
    vi.unstubAllGlobals();
  });

  it('nudges a memory after repeated identical tool failures', async () => {
    const id = seedRun();
    errorSteps(id, 'shell_exec', 'exit 127: command not found', 3);
    await learnFromRun(id);
    const proposals = listProposals();
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ kind: 'memory', title: 'lesson-shell_exec', status: 'pending' });
    const body = JSON.parse(proposals[0].body_json);
    expect(body.key).toBe('lesson-shell_exec');
    expect(body.value).toContain('exit 127');
    expect(body.scope).toBe('user');
    // Dedupe: a second pass proposes nothing new.
    await learnFromRun(id);
    expect(listProposals()).toHaveLength(1);
  });

  it('ignores isolated errors', async () => {
    const id = seedRun();
    errorSteps(id, 'shell_exec', 'exit 127', 2);
    await learnFromRun(id);
    expect(listProposals()).toHaveLength(0);
  });

  it('distills a skill from rich runs', async () => {
    globalThis.fetch = vi.fn(async () => skillCompletion({
      name: 'json-sleuth', description: 'Find keys in JSON fast.', instructions: 'Parse first.\nThen grep.',
    })) as unknown as typeof fetch;
    const id = seedRun();
    toolSteps(id, ['read_file', 'grep_search', 'calculator']);
    await learnFromRun(id);
    const proposals = listProposals();
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ kind: 'skill', title: 'json-sleuth' });
    expect(JSON.parse(proposals[0].body_json)).toMatchObject({ name: 'json-sleuth' });
  });

  it('skips thin runs, bad drafts, and taken names', async () => {
    globalThis.fetch = vi.fn(async () => skillCompletion({
      name: 'planner', description: 'x', instructions: 'y',
    })) as unknown as typeof fetch;
    const thin = seedRun();
    toolSteps(thin, ['calculator']);
    await learnFromRun(thin);
    expect(listProposals()).toHaveLength(0);

    const rich = seedRun();
    toolSteps(rich, ['read_file', 'grep_search', 'calculator']);
    await learnFromRun(rich); // 'planner' is taken
    expect(listProposals()).toHaveLength(0);

    (globalThis.fetch as any) = vi.fn(async () => skillCompletion({ name: 'Bad Name!', description: 'x', instructions: 'y' }));
    await learnFromRun(rich);
    expect(listProposals()).toHaveLength(0);
  });

  it('caps pending proposals', async () => {
    const spy = vi.fn(async () => skillCompletion({
      name: 'whatever', description: 'x', instructions: 'y',
    }));
    globalThis.fetch = spy as unknown as typeof fetch;
    for (let i = 0; i < 3; i++) {
      getDb().prepare("INSERT INTO learning_proposals (kind, title, body_json, status) VALUES ('skill', ?, '{}', 'pending')").run(`p${i}`);
    }
    const id = seedRun();
    toolSteps(id, ['read_file', 'grep_search', 'calculator']);
    await learnFromRun(id);
    expect(listProposals()).toHaveLength(3);
    expect(spy).not.toHaveBeenCalled();
  });

  it('accepts skills and memories, rejects double-resolve', async () => {
    const id = seedRun();
    errorSteps(id, 'shell_exec', 'boom', 3);
    await learnFromRun(id);
    const [nudge] = listProposals();
    const accepted = resolveProposal(nudge.id, true);
    expect(accepted.status).toBe('accepted');
    const memories = getDb().prepare('SELECT * FROM memories WHERE key = ?').get('lesson-shell_exec') as any;
    expect(memories.value).toContain('boom');
    expect(() => resolveProposal(nudge.id, true)).toThrow('already accepted');

    getDb().prepare(
      "INSERT INTO learning_proposals (kind, title, body_json, status) VALUES ('skill', 'mine', ?, 'pending')",
    ).run(JSON.stringify({ name: 'mine', description: 'd', instructions: 'i' }));
    const [skill] = listProposals();
    resolveProposal(skill.id, true);
    expect(getDb().prepare('SELECT * FROM skills WHERE name = ?').get('mine')).toBeTruthy();

    getDb().prepare(
      "INSERT INTO learning_proposals (kind, title, body_json, status) VALUES ('skill', 'drop', ?, 'pending')",
    ).run(JSON.stringify({ name: 'drop', description: 'd', instructions: 'i' }));
    const [drop] = listProposals().filter(p => p.title === 'drop');
    expect(resolveProposal(drop.id, false).status).toBe('discarded');
    expect(getDb().prepare('SELECT * FROM skills WHERE name = ?').get('drop')).toBeFalsy();
    expect(() => resolveProposal(99999, true)).toThrow('not found');
  });

  it('searches past runs by keyword', () => {
    getDb().prepare(
      `INSERT INTO agent_runs (goal, model, tools_json, skills_json, status, steps_used, final_answer) VALUES
       ('Fix the login redirect loop', 'auto', '[]', '[]', 'done', 3, 'Fixed by clearing the session cookie.'),
       ('Write a haiku about databases', 'auto', '[]', '[]', 'done', 1, 'Rows in silent lakes.')`,
    ).run();
    const hits = searchRuns('login redirect');
    expect(hits).toHaveLength(1);
    expect(hits[0].goal).toContain('login redirect');
    expect(searchRuns('login haiku')).toHaveLength(0);
    expect(searchRuns('x')).toHaveLength(0);
  });
});
