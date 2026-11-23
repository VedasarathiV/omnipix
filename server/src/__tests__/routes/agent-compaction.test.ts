import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

async function waitForTerminal(id: number): Promise<any> {
  for (let i = 0; i < 200; i++) {
    const { body } = await call('GET', `/api/agents/runs/${id}`);
    if (body.status !== 'running' && body.status !== 'awaiting_approval') return body;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error('run did not finish in time');
}

describe('context compaction', () => {
  beforeEach(async () => {
    await __quiesceAgentRuns();
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    clearRouterPressure();
    __clearRiskOverrides();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omnipix-compaction-'));
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

  it('summarizes and continues past the step budget', async () => {
    const bodies: string[] = [];
    let calls = 0;
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ''));
      calls++;
      if (calls === 1) return completion(toolCall('c1', 'calculator', { expression: '(12 + 8) / 4' }));
      if (calls === 2) return completion({ role: 'assistant', content: 'Progress: computed (12+8)/4 = 5 with calculator.' });
      return completion({ role: 'assistant', content: 'The answer is 5.' });
    }) as unknown as typeof fetch;

    const created = await call('POST', '/api/agents/runs', {
      goal: 'What is (12+8)/4?', model: 'llama-3.1-8b-instant', tools: ['calculator'], maxSteps: 1,
    });
    const run = await waitForTerminal(created.body.id);
    expect(run.status).toBe('done');
    expect(run.final_answer).toBe('The answer is 5.');
    const compact = run.steps.find((s: any) => s.kind === 'compact');
    expect(compact).toMatchObject({ label: 'compact' });
    expect(compact.content.cycle).toBe(1);
    expect(compact.content.summary).toContain('computed (12+8)/4');
    // The summarizer saw the transcript, and the next turn saw the summary.
    expect(bodies.some(b => b.includes('Summarize this agent transcript'))).toBe(true);
    expect(bodies.some(b => b.includes('Session summary of previous work'))).toBe(true);
    expect(bodies.some(b => b.includes('(12 + 8) / 4'))).toBe(true);
  });

  it('keeps the legacy hard cap at compactions 0', async () => {
    globalThis.fetch = vi.fn(async () =>
      completion(toolCall('c1', 'calculator', { expression: '1 + 1' })),
    ) as unknown as typeof fetch;
    const created = await call('POST', '/api/agents/runs', {
      goal: 'Never finish', model: 'llama-3.1-8b-instant', tools: ['calculator'], maxSteps: 1, compactions: 0,
    });
    const run = await waitForTerminal(created.body.id);
    expect(run.status).toBe('error');
    expect(run.error).toBe('step budget exhausted after 1 steps');
    expect(run.steps.some((s: any) => s.kind === 'compact')).toBe(false);
  });

  it('ends after the compaction budget is spent', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls === 2) return completion({ role: 'assistant', content: 'Summary: still going.' });
      return completion(toolCall(`c${calls}`, 'calculator', { expression: '1 + 1' }));
    }) as unknown as typeof fetch;
    const created = await call('POST', '/api/agents/runs', {
      goal: 'Never finish', model: 'llama-3.1-8b-instant', tools: ['calculator'], maxSteps: 1, compactions: 1,
    });
    const run = await waitForTerminal(created.body.id);
    expect(run.status).toBe('error');
    expect(run.error).toBe('step budget exhausted after 1 steps (and 1 compaction)');
    expect(run.steps.filter((s: any) => s.kind === 'compact')).toHaveLength(1);
  });

  it('fails loudly when compaction itself fails', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls === 1) return completion(toolCall('c1', 'calculator', { expression: '1 + 1' }));
      // The summary turn returns a tool call with no text: unusable.
      return completion(toolCall('evil', 'calculator', { expression: '2 + 2' }));
    }) as unknown as typeof fetch;
    const created = await call('POST', '/api/agents/runs', {
      goal: 'Never finish', model: 'llama-3.1-8b-instant', tools: ['calculator'], maxSteps: 1, compactions: 2,
    });
    const run = await waitForTerminal(created.body.id);
    expect(run.status).toBe('error');
    expect(run.error).toContain('compaction 1 failed');
  });

  it('validates the compactions range', async () => {
    expect((await call('POST', '/api/agents/runs', { goal: 'x', compactions: 99 })).status).toBe(400);
    expect((await call('POST', '/api/agents/runs', { goal: 'x', compactions: -1 })).status).toBe(400);
  });

  it('compacts on context pressure before the budget runs out', async () => {
    __setRiskOverride('write_file', 'read');
    // Headroom past the seed 6k TPM ceiling so the transcript can grow.
    getDb().prepare("UPDATE models SET tpm_limit = 1000000 WHERE model_id = 'llama-3.1-8b-instant'").run();
    const big = 'x'.repeat(9000);
    let calls = 0;
    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = String(init?.body ?? '');
      if (body.includes('Summarize this agent transcript')) {
        return completion({ role: 'assistant', content: 'Summary: read the big file many times.' });
      }
      calls++;
      if (calls === 1) return completion(toolCall('c1', 'write_file', { path: 'big.txt', content: big }));
      if (calls <= 14) return completion(toolCall(`c${calls}`, 'read_file', { path: 'big.txt' }));
      return completion({ role: 'assistant', content: 'Done reading.' });
    }) as unknown as typeof fetch;

    const created = await call('POST', '/api/agents/runs', {
      goal: 'Read big.txt repeatedly', model: 'llama-3.1-8b-instant',
      tools: ['write_file', 'read_file'], maxSteps: 25,
    });
    const run = await waitForTerminal(created.body.id);
    expect(run.status).toBe('done');
    const compact = run.steps.find((s: any) => s.kind === 'compact');
    expect(compact.content).toMatchObject({ cycle: 1, trigger: 'pressure' });
    // A pre-compress checkpoint snapshots the workspace first.
    const checkpoints = await call('GET', `/api/agents/runs/${created.body.id}/checkpoints`);
    expect(checkpoints.body.checkpoints.map((c: any) => c.label)).toContain('pre-compact-1');
  });

  it('recovers from a provider context overflow', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = String(init?.body ?? '');
      if (body.includes('Summarize this agent transcript')) {
        return completion({ role: 'assistant', content: 'Summary: computed 5.' });
      }
      calls++;
      if (calls === 1) {
        return new Response(JSON.stringify({ error: { message: 'maximum context length exceeded', code: 'context_length_exceeded' } }), {
          status: 413, headers: { 'content-type': 'application/json' },
        });
      }
      if (calls === 2) return completion(toolCall('c1', 'calculator', { expression: '2 + 3' }));
      return completion({ role: 'assistant', content: 'The answer is 5.' });
    }) as unknown as typeof fetch;

    const created = await call('POST', '/api/agents/runs', {
      goal: 'What is 2+3?', model: 'llama-3.1-8b-instant', tools: ['calculator'], maxSteps: 4,
    });
    const run = await waitForTerminal(created.body.id);
    expect(run.status).toBe('done');
    expect(run.final_answer).toBe('The answer is 5.');
    expect(run.steps.find((s: any) => s.kind === 'compact').content.trigger).toBe('overflow');
  });

  it('fails the run when overflow recovery has no cycles left', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: 'maximum context length exceeded' } }), {
        status: 413, headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;
    const created = await call('POST', '/api/agents/runs', {
      goal: 'Doomed', model: 'llama-3.1-8b-instant', tools: ['calculator'], maxSteps: 2, compactions: 0,
    });
    const run = await waitForTerminal(created.body.id);
    expect(run.status).toBe('error');
    expect(run.steps.some((s: any) => s.kind === 'compact')).toBe(false);
  });
});
