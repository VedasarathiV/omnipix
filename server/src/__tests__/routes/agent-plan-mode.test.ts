import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

async function waitForStatus(id: number, status: string): Promise<any> {
  for (let i = 0; i < 200; i++) {
    const { body } = await call('GET', `/api/agents/runs/${id}`);
    if (body.status === status) return body;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error(`run ${id} never reached ${status}`);
}

async function waitForTerminal(id: number): Promise<any> {
  for (let i = 0; i < 200; i++) {
    const { body } = await call('GET', `/api/agents/runs/${id}`);
    if (body.status !== 'running' && body.status !== 'awaiting_approval') return body;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error('run did not finish in time');
}

describe('plan mode', () => {
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

  it('parks before acting; approval resumes into the tool loop', async () => {
    __setRiskOverride('calculator', 'read');
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls === 1) return completion({ role: 'assistant', content: '1. Calculate (12+8)/4 with calculator.' });
      if (calls === 2) {
        return completion({
          role: 'assistant', content: '',
          tool_calls: [{ id: 'c1', type: 'function', function: { name: 'calculator', arguments: '{"expression":"(12 + 8) / 4"}' } }],
        });
      }
      return completion({ role: 'assistant', content: 'The answer is 5.' });
    }) as unknown as typeof fetch;

    const created = await call('POST', '/api/agents/runs', {
      goal: 'What is (12+8)/4?', model: 'llama-3.1-8b-instant',
      tools: ['calculator'], planMode: true,
    });
    expect(created.status).toBe(202);
    const id = created.body.id;
    const parked = await waitForStatus(id, 'awaiting_approval');
    expect(parked.plan_mode).toBe(1);
    // Nothing acted yet: exactly one model call (the plan) and one plan step.
    expect(calls).toBe(1);
    const planStep = parked.steps.find((s: any) => s.kind === 'plan');
    expect(planStep.label).toBe('plan');
    expect(planStep.content.text).toContain('Calculate');
    expect(parked.steps.some((s: any) => s.kind === 'tool_call')).toBe(false);

    const pending = await call('GET', '/api/agents/approvals?status=pending');
    expect(pending.body.approvals).toHaveLength(1);
    expect(pending.body.approvals[0]).toMatchObject({ run_id: id, tool: 'plan', risk: 'read' });
    expect(pending.body.approvals[0].summary).toContain('Review plan:');

    const decided = await call('POST', `/api/agents/approvals/${pending.body.approvals[0].id}/decide`, { approved: true });
    expect(decided.status).toBe(200);
    const done = await waitForTerminal(id);
    expect(done.status).toBe('done');
    expect(done.final_answer).toBe('The answer is 5.');
    expect(done.steps.map((s: any) => s.kind)).toContain('tool_call');
  });

  it('denial stops the run with nothing executed', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      return completion({ role: 'assistant', content: '1. Delete everything.' });
    }) as unknown as typeof fetch;

    const created = await call('POST', '/api/agents/runs', {
      goal: 'Clean up', model: 'llama-3.1-8b-instant', planMode: true,
    });
    const id = created.body.id;
    await waitForStatus(id, 'awaiting_approval');
    const pending = await call('GET', '/api/agents/approvals?status=pending');
    await call('POST', `/api/agents/approvals/${pending.body.approvals[0].id}/decide`, { approved: false });
    const run = await waitForTerminal(id);
    expect(run.status).toBe('stopped');
    expect(run.error).toBe('plan denied by operator');
    expect(run.steps.some((s: any) => s.kind === 'tool_call')).toBe(false);
    expect(calls).toBe(1);
  });

  it('drops tool calls smuggled into the plan turn', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls === 1) {
        return completion({
          role: 'assistant', content: '1. Sneaky plan.',
          tool_calls: [{ id: 'evil', type: 'function', function: { name: 'calculator', arguments: '{"expression":"1+1"}' } }],
        });
      }
      return completion({ role: 'assistant', content: 'Done without tools.' });
    }) as unknown as typeof fetch;

    const created = await call('POST', '/api/agents/runs', {
      goal: 'Be sneaky', model: 'llama-3.1-8b-instant',
      tools: ['calculator'], planMode: true,
    });
    const id = created.body.id;
    await waitForStatus(id, 'awaiting_approval');
    const pending = await call('GET', '/api/agents/approvals?status=pending');
    await call('POST', `/api/agents/approvals/${pending.body.approvals[0].id}/decide`, { approved: true });
    const run = await waitForTerminal(id);
    expect(run.status).toBe('done');
    expect(run.steps.some((s: any) => s.kind === 'tool_call')).toBe(false);
  });

  it('is off by default and rejects non-boolean flags', async () => {
    globalThis.fetch = vi.fn(async () =>
      completion({ role: 'assistant', content: 'no tools needed' }),
    ) as unknown as typeof fetch;
    const created = await call('POST', '/api/agents/runs', {
      goal: 'Say hi', model: 'llama-3.1-8b-instant', tools: ['calculator'],
    });
    const run = await waitForTerminal(created.body.id);
    expect(run.status).toBe('done');
    expect(run.plan_mode).toBe(0);
    expect(run.steps.some((s: any) => s.kind === 'plan')).toBe(false);
    expect((await call('POST', '/api/agents/runs', { goal: 'x', planMode: 'yes' })).status).toBe(400);
  });
});
