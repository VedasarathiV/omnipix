import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb, getDb } from '../../db/index.js';
import { encrypt } from '../../lib/crypto.js';
import { clearRouterPressure } from '../../services/penalty-inspector.js';
import { __clearRiskOverrides } from '../../lib/agent-policy.js';
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

function completion(message: Record<string, unknown>) {
  return new Response(JSON.stringify({
    id: 'x', object: 'chat.completion', created: 1, model: 'llama-3.1-8b-instant',
    choices: [{ index: 0, message, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

async function waitForTerminal(id: number): Promise<any> {
  for (let i = 0; i < 200; i++) {
    const { body } = await call('GET', `/api/agents/runs/${id}`);
    if (body.status !== 'running' && body.status !== 'awaiting_approval') return body;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error('run did not finish in time');
}

async function waitForProposals(count: number): Promise<any[]> {
  for (let i = 0; i < 200; i++) {
    const { body } = await call('GET', '/api/agents/proposals');
    if (body.proposals.length >= count) return body.proposals;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error('proposals did not land in time');
}

describe('learning loop', () => {
  beforeEach(async () => {
    await __quiesceAgentRuns();
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    clearRouterPressure();
    __clearRiskOverrides();
    app = createApp();
    dashToken = mintDashboardToken();
    const { encrypted, iv, authTag } = encrypt('groq-key');
    getDb().prepare(
      "INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled) VALUES ('groq', 'test', ?, ?, ?, 'healthy', 1)",
    ).run(encrypted, iv, authTag);
  });

  afterEach(() => {
    globalThis.fetch = nativeFetch;
    __clearRiskOverrides();
    vi.unstubAllGlobals();
  });

  it('proposes a skill after a rich run', async () => {
    const script = [
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'calculator', arguments: '{"expression":"1+1"}' } }] },
      { role: 'assistant', content: '', tool_calls: [{ id: 'c2', type: 'function', function: { name: 'current_time', arguments: '{}' } }] },
      { role: 'assistant', content: '', tool_calls: [{ id: 'c3', type: 'function', function: { name: 'read_file', arguments: '{"path":"nope.txt"}' } }] },
      { role: 'assistant', content: 'All explored.' },
    ];
    let calls = 0;
    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = String(init?.body ?? '');
      if (body.includes('Distill ONE reusable skill')) {
        return completion({
          role: 'assistant',
          content: JSON.stringify({ name: 'explorer', description: 'Explore first.', instructions: 'Look around.\nThen act.' }),
        });
      }
      return completion(script[Math.min(calls++, script.length - 1)]);
    }) as unknown as typeof fetch;

    const created = await call('POST', '/api/agents/runs', {
      goal: 'Explore the system thoroughly', model: 'llama-3.1-8b-instant',
      tools: ['calculator', 'current_time', 'read_file'],
    });
    const run = await waitForTerminal(created.body.id);
    expect(run.status).toBe('done');
    const proposals = await waitForProposals(1);
    expect(proposals[0]).toMatchObject({ kind: 'skill', title: 'explorer', source_run_id: run.id });

    const accepted = await call('POST', `/api/agents/proposals/${proposals[0].id}/accept`);
    expect(accepted.status).toBe(200);
    expect(accepted.body.proposal.status).toBe('accepted');
    const skills = await call('GET', '/api/skills');
    expect(skills.body.skills.map((s: any) => s.name)).toContain('explorer');
  });

  it('accepts, discards, and validates proposals', async () => {
    getDb().prepare(
      "INSERT INTO learning_proposals (kind, title, body_json, status) VALUES ('skill', 'mine', ?, 'pending')",
    ).run(JSON.stringify({ name: 'mine', description: 'd', instructions: 'i' }));
    getDb().prepare(
      "INSERT INTO learning_proposals (kind, title, body_json, status) VALUES ('memory', 'lesson-x', ?, 'pending')",
    ).run(JSON.stringify({ key: 'lesson-x', value: 'v', scope: 'user', projectKey: '' }));
    expect((await call('GET', '/api/agents/proposals')).body.proposals).toHaveLength(2);

    const memory = (await call('GET', '/api/agents/proposals')).body.proposals.find((p: any) => p.kind === 'memory');
    expect((await call('POST', `/api/agents/proposals/${memory.id}/accept`)).status).toBe(200);
    expect(getDb().prepare('SELECT * FROM memories WHERE key = ?').get('lesson-x')).toBeTruthy();

    const skill = (await call('GET', '/api/agents/proposals')).body.proposals.find((p: any) => p.kind === 'skill');
    expect((await call('POST', `/api/agents/proposals/${skill.id}/discard`)).status).toBe(200);
    expect((await call('POST', `/api/agents/proposals/${skill.id}/accept`)).status).toBe(400);
    expect((await call('POST', '/api/agents/proposals/99999/accept')).status).toBe(404);
    expect((await call('POST', '/api/agents/proposals/nope/accept')).status).toBe(400);
    expect((await call('GET', '/api/agents/proposals?status=bogus')).status).toBe(400);
    expect((await call('GET', '/api/agents/proposals', undefined, false)).status).toBe(401);
  });

  it('searches past runs', async () => {
    globalThis.fetch = vi.fn(async () => completion({ role: 'assistant', content: 'done' })) as unknown as typeof fetch;
    const created = await call('POST', '/api/agents/runs', {
      goal: 'Defeat the login redirect gremlin', model: 'llama-3.1-8b-instant', tools: ['calculator'],
    });
    await waitForTerminal(created.body.id);
    const found = await call('GET', '/api/agents/runs/search?q=login+redirect');
    expect(found.status).toBe(200);
    expect(found.body.runs).toHaveLength(1);
    expect(found.body.runs[0].id).toBe(created.body.id);
    expect((await call('GET', '/api/agents/runs/search?q=unrelated+zebra')).body.runs).toHaveLength(0);
    expect((await call('GET', '/api/agents/runs/search')).status).toBe(400);
    expect((await call('GET', '/api/agents/runs/search?q=x', undefined, false)).status).toBe(401);
  });
});
