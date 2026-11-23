import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb, getDb } from '../../db/index.js';
import { encrypt } from '../../lib/crypto.js';
import { clearRouterPressure } from '../../services/penalty-inspector.js';
import { __clearRiskOverrides, __setRiskOverride } from '../../lib/agent-policy.js';
import { __quiesceAgentRuns } from '../../services/agent-runtime.js';
import { mintDashboardToken, isGatedApiPath } from '../helpers/auth.js';

let app: Express;
let dashToken: string;
const nativeFetch = globalThis.fetch.bind(globalThis);

const GIT = (() => {
  try {
    return spawnSync('git', ['--version'], { encoding: 'utf8', timeout: 5000 }).status === 0;
  } catch {
    return false;
  }
})();

async function call(method: string, path: string, body?: unknown, authed = true) {
  const server = app.listen(0, '127.0.0.1');
  if (!server.listening) await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const addr = server.address() as { port: number };
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authed && isGatedApiPath(path)) headers['Authorization'] = `Bearer ${dashToken}`;
  const res = await nativeFetch(`http://127.0.0.1:${addr.port}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  server.close();
  return { status: res.status, body: data as any };
}

function addKey(platform: string): void {
  const { encrypted, iv, authTag } = encrypt(`${platform}-key`);
  getDb().prepare(
    "INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled) VALUES (?, 'test', ?, ?, ?, 'healthy', 1)",
  ).run(platform, encrypted, iv, authTag);
}

function completion(message: Record<string, unknown>) {
  return new Response(JSON.stringify({
    id: 'x', object: 'chat.completion', created: 1, model: 'llama-3.1-8b-instant',
    choices: [{ index: 0, message, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

async function waitFor(id: number, statuses: string[]): Promise<any> {
  for (let i = 0; i < 200; i++) {
    const { body } = await call('GET', `/api/agents/runs/${id}`);
    if (statuses.includes(body.status)) return body;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error('run did not reach a wanted status in time');
}

describe('agent sessions and approvals', () => {
  beforeEach(async () => {
    await __quiesceAgentRuns();
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    clearRouterPressure();
    __clearRiskOverrides();
    app = createApp();
    dashToken = mintDashboardToken();
    addKey('groq');
  });

  afterEach(() => {
    globalThis.fetch = nativeFetch;
    __clearRiskOverrides();
    vi.unstubAllGlobals();
  });

  it('requires dashboard auth', async () => {
    expect((await call('GET', '/api/agents/sessions', undefined, false)).status).toBe(401);
    expect((await call('GET', '/api/agents/approvals', undefined, false)).status).toBe(401);
  });

  it('creates sessions and auto-attaches runs to them', async () => {
    const session = await call('POST', '/api/agents/sessions', { title: 'My project' });
    expect(session.status).toBe(201);
    expect(session.body.title).toBe('My project');

    globalThis.fetch = vi.fn(async () => completion({ role: 'assistant', content: 'done' })) as unknown as typeof fetch;
    const run = await call('POST', '/api/agents/runs', { goal: 'say done', model: 'llama-3.1-8b-instant', sessionId: session.body.id });
    expect(run.status).toBe(202);
    expect(run.body.session_id).toBe(session.body.id);
    await waitFor(run.body.id, ['done']);

    // No session passed: one is auto-created from the goal.
    const run2 = await call('POST', '/api/agents/runs', { goal: 'second goal here' });
    expect(run2.status).toBe(202);
    expect(run2.body.session_id).not.toBe(session.body.id);
    const detail = await call('GET', `/api/agents/sessions/${run2.body.session_id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.title).toBe('second goal here');
    expect(detail.body.runs.map((r: any) => r.id)).toContain(run2.body.id);

    expect((await call('POST', '/api/agents/runs', { goal: 'x', sessionId: 99999 })).status).toBe(400);
    const filtered = await call('GET', `/api/agents/runs?session=${session.body.id}`);
    expect(filtered.body.runs.map((r: any) => r.id)).toEqual([run.body.id]);
    expect((await call('GET', '/api/agents/runs?session=nope')).status).toBe(400);
  });

  it('lists sessions newest-touched first and deletes with cascade', async () => {
    globalThis.fetch = vi.fn(async () => completion({ role: 'assistant', content: 'done' })) as unknown as typeof fetch;
    const first = await call('POST', '/api/agents/sessions', { title: 'first' });
    await call('POST', '/api/agents/sessions', { title: 'second' });
    const run = await call('POST', '/api/agents/runs', { goal: 'g', sessionId: first.body.id });
    await waitFor(run.body.id, ['done']);

    const listed = await call('GET', '/api/agents/sessions');
    expect(listed.body.sessions.map((s: any) => s.title)).toEqual(['first', 'second']);
    expect(listed.body.sessions[0]).toMatchObject({ run_count: 1, last_status: 'done' });

    expect((await call('DELETE', `/api/agents/sessions/${first.body.id}`)).status).toBe(200);
    expect((await call('GET', `/api/agents/runs/${run.body.id}`)).status).toBe(404);
    expect((await call('DELETE', '/api/agents/sessions/99999')).status).toBe(404);
  });

  it('rejects sessions linked to unknown conversations', async () => {
    expect((await call('POST', '/api/agents/sessions', { conversationId: 99999 })).status).toBe(400);
    expect((await call('GET', '/api/agents/sessions/12abc')).status).toBe(400);
    expect((await call('GET', '/api/agents/sessions/99999')).status).toBe(404);
  });

  it('carries a project folder on the session and runs inherit it', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnipix-handoff-'));
    try {
      const bad = await call('POST', '/api/agents/sessions', { title: 'bad', workdir: path.join(dir, 'nope') });
      expect(bad.status).toBe(400);
      const session = await call('POST', '/api/agents/sessions', { title: 'proj', workdir: dir });
      expect(session.status).toBe(201);
      expect(session.body.workdir).toBe(path.resolve(dir));
      const detail = await call('GET', `/api/agents/sessions/${session.body.id}`);
      expect(detail.body.workdir).toBe(path.resolve(dir));

      globalThis.fetch = vi.fn(async () => completion({ role: 'assistant', content: 'done' })) as unknown as typeof fetch;
      // No workdir passed: the run inherits the session's folder.
      const run = await call('POST', '/api/agents/runs', { goal: 'say done', model: 'llama-3.1-8b-instant', sessionId: session.body.id });
      expect(run.status).toBe(202);
      expect(run.body.workdir).toBe(path.resolve(dir));
      await waitFor(run.body.id, ['done']);
      // Explicit workdir wins over the session's.
      const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'omnipix-handoff2-'));
      try {
        const run2 = await call('POST', '/api/agents/runs', { goal: 'say done', model: 'llama-3.1-8b-instant', sessionId: session.body.id, workdir: dir2 });
        expect(run2.status).toBe(202);
        expect(run2.body.workdir).toBe(path.resolve(dir2));
        await waitFor(run2.body.id, ['done']);
      } finally {
        fs.rmSync(dir2, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it.runIf(GIT)('commits only the approved files on a scoped decision', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { spawnSync } = await import('node:child_process');
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omnipix-scope-'));
    process.env.OMNIPIX_WORKSPACE_ROOT = tmpRoot;
    process.env.GIT_AUTHOR_NAME = 't';
    process.env.GIT_AUTHOR_EMAIL = 't@t.t';
    process.env.GIT_COMMITTER_NAME = 't';
    process.env.GIT_COMMITTER_EMAIL = 't@t.t';
    try {
      // Fresh :memory: DB per test, so this run is id 1.
      const ws = path.join(tmpRoot, 'run-1');
      fs.mkdirSync(ws, { recursive: true });
      spawnSync('git', ['-C', ws, 'init', '-b', 'main'], { encoding: 'utf8' });
      spawnSync('git', ['-C', ws, 'commit', '--allow-empty', '-m', 'init'], { encoding: 'utf8' });
      fs.writeFileSync(path.join(ws, 'a.txt'), 'a\n');
      fs.writeFileSync(path.join(ws, 'b.txt'), 'b\n');

      let calls = 0;
      globalThis.fetch = vi.fn(async () => {
        calls++;
        if (calls === 1) {
          return completion({
            role: 'assistant', content: '',
            tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'git_commit', arguments: '{"message":"wip"}' } }],
          });
        }
        return completion({ role: 'assistant', content: 'Committed.' });
      }) as unknown as typeof fetch;

      const created = await call('POST', '/api/agents/runs', {
        goal: 'Commit the work', model: 'llama-3.1-8b-instant', tools: ['git_commit'],
      });
      expect(created.status).toBe(202);
      await waitFor(created.body.id, ['awaiting_approval']);
      const pending = await call('GET', '/api/agents/approvals?status=pending');
      expect(pending.body.approvals).toHaveLength(1);
      const decided = await call('POST', `/api/agents/approvals/${pending.body.approvals[0].id}/decide`, {
        approved: true, paths: ['a.txt'],
      });
      expect(decided.status).toBe(200);
      const done = await waitFor(created.body.id, ['done']);
      expect(done.status).toBe('done');
      const names = spawnSync('git', ['-C', ws, 'show', '--name-only', '--format=', 'HEAD'], { encoding: 'utf8' });
      expect(names.stdout).toContain('a.txt');
      expect(names.stdout).not.toContain('b.txt');
    } finally {
      delete process.env.OMNIPIX_WORKSPACE_ROOT;
      delete process.env.GIT_AUTHOR_NAME;
      delete process.env.GIT_AUTHOR_EMAIL;
      delete process.env.GIT_COMMITTER_NAME;
      delete process.env.GIT_COMMITTER_EMAIL;
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('refuses runs when the session folder is gone', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnipix-gone-'));
    const session = await call('POST', '/api/agents/sessions', { title: 'gone', workdir: dir });
    expect(session.status).toBe(201);
    fs.rmSync(dir, { recursive: true, force: true });
    globalThis.fetch = vi.fn(async () => completion({ role: 'assistant', content: 'done' })) as unknown as typeof fetch;
    const run = await call('POST', '/api/agents/runs', { goal: 'say done', model: 'llama-3.1-8b-instant', sessionId: session.body.id });
    expect(run.status).toBe(400);
    expect(run.body.error.message).toContain('gone');
  });

  it('parks a run for approval and resumes it on approve', async () => {
    __setRiskOverride('calculator', 'write');
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls === 1) {
        return completion({
          role: 'assistant', content: '',
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'calculator', arguments: '{"expression":"2 + 2"}' } }],
        });
      }
      return completion({ role: 'assistant', content: 'The answer is 4.' });
    }) as unknown as typeof fetch;

    const created = await call('POST', '/api/agents/runs', {
      goal: 'What is 2 + 2?', model: 'llama-3.1-8b-instant', tools: ['calculator'],
    });
    expect(created.status).toBe(202);
    const parked = await waitFor(created.body.id, ['awaiting_approval']);
    expect(parked.status).toBe('awaiting_approval');

    const pending = await call('GET', '/api/agents/approvals?status=pending');
    expect(pending.body.approvals).toHaveLength(1);
    expect(pending.body.approvals[0]).toMatchObject({
      run_id: created.body.id, tool: 'calculator', risk: 'write', status: 'pending',
    });
    expect(pending.body.approvals[0].summary).toContain('2 + 2');

    const decided = await call('POST', `/api/agents/approvals/${pending.body.approvals[0].id}/decide`, { approved: true });
    expect(decided.status).toBe(200);
    expect(decided.body.approval.status).toBe('approved');

    const done = await waitFor(created.body.id, ['done']);
    expect(done.final_answer).toBe('The answer is 4.');
    expect(done.steps.map((s: any) => s.kind)).toEqual(['tool_call', 'tool_result', 'thought', 'answer']);
  });

  it('continues the loop with a denial message on deny', async () => {
    __setRiskOverride('calculator', 'write');
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls === 1) {
        return completion({
          role: 'assistant', content: '',
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'calculator', arguments: '{"expression":"2 + 2"}' } }],
        });
      }
      return completion({ role: 'assistant', content: 'I could not calculate that.' });
    }) as unknown as typeof fetch;

    const created = await call('POST', '/api/agents/runs', {
      goal: 'What is 2 + 2?', model: 'llama-3.1-8b-instant', tools: ['calculator'],
    });
    await waitFor(created.body.id, ['awaiting_approval']);
    const pending = await call('GET', '/api/agents/approvals?status=pending');
    const decided = await call('POST', `/api/agents/approvals/${pending.body.approvals[0].id}/decide`, { approved: false });
    expect(decided.status).toBe(200);
    const done = await waitFor(created.body.id, ['done']);
    expect(done.final_answer).toBe('I could not calculate that.');
    expect(done.steps.find((s: any) => s.kind === 'tool_result').content.result).toContain('denied by operator');
  });

  it('expires the approval when a parked run is stopped', async () => {
    __setRiskOverride('calculator', 'write');
    globalThis.fetch = vi.fn(async () => completion({
      role: 'assistant', content: '',
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'calculator', arguments: '{"expression":"2 + 2"}' } }],
    })) as unknown as typeof fetch;

    const created = await call('POST', '/api/agents/runs', {
      goal: 'What is 2 + 2?', model: 'llama-3.1-8b-instant', tools: ['calculator'],
    });
    await waitFor(created.body.id, ['awaiting_approval']);
    await call('POST', `/api/agents/runs/${created.body.id}/stop`);
    const stopped = await waitFor(created.body.id, ['stopped']);
    expect(stopped.status).toBe('stopped');
    const expired = await call('GET', '/api/agents/approvals?status=expired');
    expect(expired.body.approvals).toHaveLength(1);
  });

  it('validates approval reads and decisions', async () => {
    expect((await call('GET', '/api/agents/approvals?status=bogus')).status).toBe(400);
    expect((await call('GET', '/api/agents/approvals/99999')).status).toBe(404);
    expect((await call('POST', '/api/agents/approvals/99999/decide', { approved: true })).status).toBe(404);
    expect((await call('POST', '/api/agents/approvals/12abc/decide', { approved: true })).status).toBe(400);

    getDb().prepare(
      "INSERT INTO agent_runs (goal, model, status) VALUES ('g', 'auto', 'running')",
    ).run();
    const runId = (getDb().prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
    getDb().prepare(
      "INSERT INTO approvals (run_id, seq, tool, args_json, risk, summary, status) VALUES (?, 1, 'calculator', '{}', 'write', 's', 'pending')",
    ).run(runId);
    const approvalId = (getDb().prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
    expect((await call('POST', `/api/agents/approvals/${approvalId}/decide`, {})).status).toBe(400);
    expect((await call('POST', `/api/agents/approvals/${approvalId}/decide`, { approved: true })).status).toBe(200);
    expect((await call('POST', `/api/agents/approvals/${approvalId}/decide`, { approved: true })).status).toBe(409);
  });
});
