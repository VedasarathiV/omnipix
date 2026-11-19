import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb, getDb } from '../../db/index.js';
import { encrypt } from '../../lib/crypto.js';
import { clearRouterPressure } from '../../services/penalty-inspector.js';
import { __quiesceAgentRuns } from '../../services/agent-runtime.js';
import { mintDashboardToken, isGatedApiPath } from '../helpers/auth.js';

let app: Express;
let dashToken: string;
const nativeFetch = globalThis.fetch.bind(globalThis);

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

function completion(content: string) {
  return new Response(JSON.stringify({
    id: 'x', object: 'chat.completion', created: 1, model: 'llama-3.1-8b-instant',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('automations and notifications', () => {
  beforeEach(async () => {
    await __quiesceAgentRuns();
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    clearRouterPressure();
    app = createApp();
    dashToken = mintDashboardToken();
    const { encrypted, iv, authTag } = encrypt('groq-key');
    getDb().prepare(
      "INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled) VALUES ('groq', 'test', ?, ?, ?, 'healthy', 1)",
    ).run(encrypted, iv, authTag);
  });

  afterEach(() => {
    globalThis.fetch = nativeFetch;
    vi.unstubAllGlobals();
  });

  it('requires dashboard auth', async () => {
    expect((await call('GET', '/api/automations', undefined, false)).status).toBe(401);
    expect((await call('GET', '/api/notifications', undefined, false)).status).toBe(401);
  });

  it('creates, reads, updates, and deletes automations', async () => {
    const created = await call('POST', '/api/automations', {
      name: 'morning', goal: 'Brief me', schedule: '0 9 * * *',
    });
    expect(created.status).toBe(201);
    expect(created.body.automation).toMatchObject({ name: 'morning', reviewed: 0 });
    expect(created.body.automation.next_run_at).toBeTruthy();

    expect((await call('POST', '/api/automations', { name: 'morning', goal: 'x' })).status).toBe(409);
    expect((await call('POST', '/api/automations', { name: 'bad', goal: 'x', schedule: 'nope' })).status).toBe(400);

    const id = created.body.automation.id;
    expect((await call('GET', `/api/automations/${id}`)).status).toBe(200);
    expect((await call('GET', '/api/automations/99999')).status).toBe(404);
    const updated = await call('PATCH', `/api/automations/${id}`, { enabled: false });
    expect(updated.body.automation.enabled).toBe(0);
    expect((await call('PATCH', '/api/automations/99999', { enabled: true })).status).toBe(404);
    expect((await call('GET', '/api/automations')).body.automations).toHaveLength(1);
    expect((await call('DELETE', `/api/automations/${id}`)).status).toBe(200);
    expect((await call('DELETE', `/api/automations/${id}`)).status).toBe(404);
  });

  it('runs once manually and reports completion via notifications', async () => {
    let release!: (value: Response) => void;
    const gate = new Promise<Response>(resolve => { release = resolve; });
    globalThis.fetch = vi.fn(async () => gate) as unknown as typeof fetch;
    const created = await call('POST', '/api/automations', { name: 'brief', goal: 'Brief me' });
    const id = created.body.automation.id;
    const fired = await call('POST', `/api/automations/${id}/run`);
    expect(fired.status).toBe(202);
    expect(fired.body.run_id).toBeTruthy();
    // Second fire while live refuses to stack.
    expect((await call('POST', `/api/automations/${id}/run`)).status).toBe(409);
    release(completion('briefing done'));
    // Wait for the run, then tick by re-reading: the scheduler tick runs in
    // production; here the status assertion below only needs the run row.
    for (let i = 0; i < 200; i++) {
      const run = await call('GET', `/api/agents/runs/${fired.body.run_id}`);
      if (run.body.status !== 'running') break;
      await new Promise(r => setTimeout(r, 25));
    }
    const run = await call('GET', `/api/agents/runs/${fired.body.run_id}`);
    expect(run.body.status).toBe('done');
    expect((await call('POST', '/api/automations/99999/run')).status).toBe(404);
  });

  it('lists and clears notifications', async () => {
    globalThis.fetch = vi.fn(async () => completion('ok')) as unknown as typeof fetch;
    // A parked approval writes a notification.
    getDb().prepare("INSERT INTO agent_runs (goal, model, status) VALUES ('g', 'auto', 'running')").run();
    const runId = (getDb().prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
    const { parkForApproval } = await import('../../lib/agent-policy.js');
    parkForApproval(runId, 1, 'shell_exec', { command: 'ls' });
    const listed = await call('GET', '/api/notifications');
    expect(listed.status).toBe(200);
    expect(listed.body.unread).toBe(1);
    expect(listed.body.notifications[0]).toMatchObject({ kind: 'approval-pending' });
    expect((await call('GET', '/api/notifications?unread=1')).body.notifications).toHaveLength(1);
    const read = await call('POST', `/api/notifications/${listed.body.notifications[0].id}/read`);
    expect(read.body.unread).toBe(0);
    expect((await call('POST', '/api/notifications/99999/read')).status).toBe(404);
    parkForApproval(runId, 2, 'shell_exec', { command: 'ls' });
    expect((await call('POST', '/api/notifications/read-all')).body).toMatchObject({ read: 1, unread: 0 });
  });
});
