import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
let tmpRoot: string;
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

function toolCall(id: string, name: string, args: Record<string, unknown>) {
  return {
    role: 'assistant', content: '',
    tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
  };
}

async function waitForDone(id: number): Promise<any> {
  for (let i = 0; i < 200; i++) {
    const { body } = await call('GET', `/api/arena/evals/${id}`);
    if (body.status !== 'running') return body;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error('eval did not finish in time');
}

const AGENT_SUITE = {
  name: 'write-world',
  description: 'Agent writes a file.',
  items: [
    {
      id: 'world',
      prompt: 'Write world.txt containing exactly "world".',
      checks: [{ type: 'shell', value: 'test "$(cat world.txt)" = world' }],
      agent: { tools: ['write_file'], maxSteps: 4, files: { 'readme.txt': 'seeded' } },
    },
  ],
};

describe('arena eval agents', () => {
  beforeEach(async () => {
    await __quiesceAgentRuns();
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    clearRouterPressure();
    __clearRiskOverrides();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omnipix-eval-agents-'));
    process.env.OMNIPIX_WORKSPACE_ROOT = tmpRoot;
    app = createApp();
    dashToken = mintDashboardToken();
    const { encrypted, iv, authTag } = encrypt('groq-key');
    getDb().prepare(
      "INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled) VALUES ('groq', 'test', ?, ?, ?, 'healthy', 1)",
    ).run(encrypted, iv, authTag);
  });

  afterEach(() => {
    globalThis.fetch = nativeFetch;
    delete process.env.OMNIPIX_WORKSPACE_ROOT;
    __clearRiskOverrides();
    vi.unstubAllGlobals();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('runs a coding task unattended and grades the workspace', async () => {
    expect((await call('POST', '/api/arena/suites', AGENT_SUITE)).status).toBe(201);
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls === 1) return completion(toolCall('c1', 'write_file', { path: 'world.txt', content: 'world' }));
      return completion({ role: 'assistant', content: 'Wrote world.txt.' });
    }) as unknown as typeof fetch;

    const created = await call('POST', '/api/arena/evals', {
      suite: 'write-world', models: ['llama-3.1-8b-instant'],
    });
    expect(created.status).toBe(202);
    const run = await waitForDone(created.body.id);
    expect(run.status).toBe('done');
    expect(run.results[0].passed).toBe(1);
    const item = run.results[0].items[0];
    expect(item.pass).toBe(true);
    expect(item.agentStatus).toBe('done');
    expect(item.checks).toHaveLength(1);
    expect(item.checks[0]).toMatchObject({ type: 'shell', pass: true });
    expect(item.checks[0].detail).toContain('exit 0');

    // The agent run is traceable, flagged unattended, and parked nothing.
    const agent = (await call('GET', `/api/agents/runs/${item.agentRunId}`)).body;
    expect(agent.auto_approve).toBe(1);
    expect(agent.session_id).not.toBeNull();
    expect((await call('GET', '/api/agents/approvals?status=pending')).body.approvals).toHaveLength(0);
  });

  it('fails the item when the workspace checks fail', async () => {
    expect((await call('POST', '/api/arena/suites', AGENT_SUITE)).status).toBe(201);
    globalThis.fetch = vi.fn(async () =>
      completion({ role: 'assistant', content: 'I refuse to write files.' }),
    ) as unknown as typeof fetch;

    const created = await call('POST', '/api/arena/evals', {
      suite: 'write-world', models: ['llama-3.1-8b-instant'],
    });
    const run = await waitForDone(created.body.id);
    expect(run.status).toBe('done');
    expect(run.results[0].passed).toBe(0);
    const item = run.results[0].items[0];
    expect(item.pass).toBe(false);
    expect(item.agentStatus).toBe('done');
    expect(item.checks[0].detail).toContain('exit 1');
  });

  it('mixes string checks on the answer with shell checks', async () => {
    const suite = {
      ...AGENT_SUITE,
      name: 'mixed-task',
      items: [{
        ...AGENT_SUITE.items[0],
        checks: [
          { type: 'shell', value: 'test "$(cat world.txt)" = world' },
          { type: 'includes', value: 'world' },
        ],
      }],
    };
    expect((await call('POST', '/api/arena/suites', suite)).status).toBe(201);
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls === 1) return completion(toolCall('c1', 'write_file', { path: 'world.txt', content: 'world' }));
      return completion({ role: 'assistant', content: 'Something else entirely.' });
    }) as unknown as typeof fetch;

    const created = await call('POST', '/api/arena/evals', {
      suite: 'mixed-task', models: ['llama-3.1-8b-instant'],
    });
    const run = await waitForDone(created.body.id);
    const item = run.results[0].items[0];
    expect(item.pass).toBe(false);
    expect(item.checks.map((c: any) => c.pass)).toEqual([true, false]);
  });

  it('validates agent items', async () => {
    const base = AGENT_SUITE.items[0];
    const badShellNoAgent = { ...AGENT_SUITE, name: 's1', items: [{ id: 'x', prompt: 'p', checks: [{ type: 'shell', value: 'exit 0' }] }] };
    expect((await call('POST', '/api/arena/suites', badShellNoAgent)).status).toBe(400);
    const badDelegate = { ...AGENT_SUITE, name: 's2', items: [{ ...base, agent: { tools: ['delegate'] } }] };
    expect((await call('POST', '/api/arena/suites', badDelegate)).status).toBe(400);
    const badTool = { ...AGENT_SUITE, name: 's3', items: [{ ...base, agent: { tools: ['nuke_everything'] } }] };
    expect((await call('POST', '/api/arena/suites', badTool)).status).toBe(400);
    const badCmd = { ...AGENT_SUITE, name: 's4', items: [{ ...base, checks: [{ type: 'shell' }], agent: {} }] };
    expect((await call('POST', '/api/arena/suites', badCmd)).status).toBe(400);
    const badFile = { ...AGENT_SUITE, name: 's5', items: [{ ...base, agent: { files: { '../escape.txt': 'x' } } }] };
    expect((await call('POST', '/api/arena/suites', badFile)).status).toBe(400);
    const badSteps = { ...AGENT_SUITE, name: 's6', items: [{ ...base, agent: { maxSteps: 99 } }] };
    expect((await call('POST', '/api/arena/suites', badSteps)).status).toBe(400);

    expect((await call('POST', '/api/arena/suites', AGENT_SUITE)).status).toBe(201);
    expect((await call('PATCH', '/api/arena/suites/write-world', { items: badShellNoAgent.items })).status).toBe(400);
  });
});
