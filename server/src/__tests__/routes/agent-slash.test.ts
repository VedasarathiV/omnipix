import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb, getDb } from '../../db/index.js';
import { encrypt } from '../../lib/crypto.js';
import { clearRouterPressure } from '../../services/penalty-inspector.js';
import { __clearRiskOverrides } from '../../lib/agent-policy.js';
import { __quiesceAgentRuns, parseSlashSkills } from '../../services/agent-runtime.js';
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

async function waitForTerminal(id: number): Promise<any> {
  for (let i = 0; i < 200; i++) {
    const { body } = await call('GET', `/api/agents/runs/${id}`);
    if (body.status !== 'running' && body.status !== 'awaiting_approval') return body;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error('run did not finish in time');
}

describe('parseSlashSkills', () => {
  it.each([
    ['/planner do the thing', ['planner'], 'do the thing'],
    ['/planner /coder do the thing', ['planner', 'coder'], 'do the thing'],
    ['  /planner do the thing', ['planner'], 'do the thing'],
    ['/my-skill9 go', ['my-skill9'], 'go'],
    ['/planner /planner go', ['planner'], 'go'],
    ['/planner', ['planner'], ''],
  ])('parses %j', (goal, skills, rest) => {
    expect(parseSlashSkills(goal as string)).toEqual({ skills, goal: rest });
  });

  it.each([
    'do the thing',
    '/tmp/list files',
    '/v1/models check',
    '/Plan do x',
    '/ do x',
    'do /planner x',
    'mailto:me@example.com',
  ])('leaves %j alone', (goal) => {
    expect(parseSlashSkills(goal)).toEqual({ skills: [], goal });
  });
});

describe('slash invocation', () => {
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

  it('attaches slashed skills and strips the goal', async () => {
    globalThis.fetch = vi.fn(async () => completion('done')) as unknown as typeof fetch;
    const created = await call('POST', '/api/agents/runs', {
      goal: '/planner /critic Say hi', model: 'llama-3.1-8b-instant', tools: ['calculator'],
    });
    expect(created.status).toBe(202);
    expect(created.body.goal).toBe('Say hi');
    expect(created.body.skills).toEqual(['planner', 'critic']);
    const run = await waitForTerminal(created.body.id);
    expect(run.status).toBe('done');
    expect(run.skills).toEqual(['planner', 'critic']);
  });

  it('unions slash skills with explicit skills', async () => {
    globalThis.fetch = vi.fn(async () => completion('done')) as unknown as typeof fetch;
    const created = await call('POST', '/api/agents/runs', {
      goal: '/planner Say hi', skills: ['critic'], model: 'llama-3.1-8b-instant', tools: ['calculator'],
    });
    expect(created.body.skills).toEqual(['critic', 'planner']);
    await waitForTerminal(created.body.id);
  });

  it('rejects unknown, disabled, and bare slashes', async () => {
    const unknown = await call('POST', '/api/agents/runs', { goal: '/nope Say hi' });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.message).toContain('Unknown skill(s)');
    getDb().prepare("UPDATE skills SET enabled = 0 WHERE name = 'planner'").run();
    expect((await call('POST', '/api/agents/runs', { goal: '/planner Say hi' })).status).toBe(400);
    const bare = await call('POST', '/api/agents/runs', { goal: '/planner' });
    expect(bare.status).toBe(400);
    expect(bare.body.error.message).toContain('after /commands');
  });

  it('leaves path-like goals alone', async () => {
    globalThis.fetch = vi.fn(async () => completion('done')) as unknown as typeof fetch;
    const created = await call('POST', '/api/agents/runs', {
      goal: '/tmp/list files here', model: 'llama-3.1-8b-instant', tools: ['calculator'],
    });
    expect(created.status).toBe(202);
    expect(created.body.goal).toBe('/tmp/list files here');
    await waitForTerminal(created.body.id);
  });
});
