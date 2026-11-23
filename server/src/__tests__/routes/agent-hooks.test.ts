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
import { runWorkspace } from '../../lib/workspace.js';
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

describe('agent hooks', () => {
  beforeEach(async () => {
    await __quiesceAgentRuns();
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    clearRouterPressure();
    __clearRiskOverrides();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omnipix-hooks-'));
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

  it('creates, lists, updates, and deletes hooks', async () => {
    const created = await call('POST', '/api/agents/hooks', {
      name: 'no-div-zero', event: 'pre_tool', toolFilter: 'calculator', command: 'exit 0',
    });
    expect(created.status).toBe(201);
    expect(created.body.hook).toMatchObject({ name: 'no-div-zero', event: 'pre_tool', tool_filter: 'calculator', enabled: 1 });
    const id = created.body.hook.id;

    expect((await call('GET', '/api/agents/hooks')).body.hooks).toHaveLength(1);
    expect((await call('GET', `/api/agents/hooks/${id}`)).body.hook.command).toBe('exit 0');

    const patched = await call('PATCH', `/api/agents/hooks/${id}`, { enabled: false, command: 'exit 1' });
    expect(patched.body.hook).toMatchObject({ enabled: 0, command: 'exit 1' });

    expect((await call('DELETE', `/api/agents/hooks/${id}`)).status).toBe(200);
    expect((await call('GET', '/api/agents/hooks')).body.hooks).toHaveLength(0);
  });

  it('validates hooks', async () => {
    expect((await call('POST', '/api/agents/hooks', { name: 'x', event: 'nope', command: 'exit 0' })).status).toBe(400);
    expect((await call('POST', '/api/agents/hooks', { name: 'x', event: 'pre_tool', toolFilter: 'nuke', command: 'exit 0' })).status).toBe(400);
    expect((await call('POST', '/api/agents/hooks', { name: 'x', event: 'pre_tool', command: 'rm -rf /' })).status).toBe(400);
    expect((await call('POST', '/api/agents/hooks', { name: 'x', event: 'pre_tool', command: 'exit 0', timeoutMs: 50 })).status).toBe(400);
    expect((await call('POST', '/api/agents/hooks', { name: '', event: 'pre_tool', command: 'exit 0' })).status).toBe(400);
    expect((await call('GET', '/api/agents/hooks/99999')).status).toBe(404);
    expect((await call('GET', '/api/agents/hooks/nope')).status).toBe(400);
    expect((await call('PATCH', '/api/agents/hooks/99999', { enabled: true })).status).toBe(404);
    expect((await call('DELETE', '/api/agents/hooks/99999')).status).toBe(404);
    expect((await call('GET', '/api/agents/hooks', undefined, false)).status).toBe(401);
  });

  it('vetoes the call on pre_tool exit != 0 without parking an approval', async () => {
    await call('POST', '/api/agents/hooks', {
      name: 'veto-calc', event: 'pre_tool', toolFilter: 'calculator', command: 'echo no math >&2; exit 1',
    });
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls === 1) return completion(toolCall('c1', 'calculator', { expression: '2 + 2' }));
      return completion({ role: 'assistant', content: 'Blocked.' });
    }) as unknown as typeof fetch;

    const created = await call('POST', '/api/agents/runs', {
      goal: 'Add', model: 'llama-3.1-8b-instant', tools: ['calculator'],
    });
    const run = await waitForTerminal(created.body.id);
    expect(run.status).toBe('done');
    const result = run.steps.find((s: any) => s.kind === 'tool_result');
    expect(result.content.result).toContain('denied by hook "veto-calc": no math');
    const hookStep = run.steps.find((s: any) => s.kind === 'hook');
    expect(hookStep.content).toMatchObject({ event: 'pre_tool', hook: 'veto-calc', allowed: false });
    // No approval was parked: the veto spared the human.
    expect((await call('GET', '/api/agents/approvals?status=pending')).body.approvals).toHaveLength(0);
  });

  it('runs pre_tool hooks in the workspace with the payload env', async () => {
    await call('POST', '/api/agents/hooks', {
      name: 'witness', event: 'pre_tool', toolFilter: 'calculator',
      command: 'test "$OMNIPIX_HOOK_TOOL" = calculator && touch saw-calculator',
    });
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls === 1) return completion(toolCall('c1', 'calculator', { expression: '2 + 2' }));
      return completion({ role: 'assistant', content: 'The answer is 4.' });
    }) as unknown as typeof fetch;

    const created = await call('POST', '/api/agents/runs', {
      goal: 'Add', model: 'llama-3.1-8b-instant', tools: ['calculator'],
    });
    const run = await waitForTerminal(created.body.id);
    expect(run.status).toBe('done');
    expect(run.steps.find((s: any) => s.kind === 'tool_result').content.result).toBe('4');
    // Success is silent (no hook step) but the side effect proves it ran.
    expect(run.steps.some((s: any) => s.kind === 'hook')).toBe(false);
    expect(fs.existsSync(path.join(runWorkspace(run.id), 'saw-calculator'))).toBe(true);
  });

  it('records post_tool failures without changing the result', async () => {
    await call('POST', '/api/agents/hooks', {
      name: 'flaky-observer', event: 'post_tool', command: 'echo boom >&2; exit 3',
    });
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls === 1) return completion(toolCall('c1', 'calculator', { expression: '2 + 2' }));
      return completion({ role: 'assistant', content: 'The answer is 4.' });
    }) as unknown as typeof fetch;

    const created = await call('POST', '/api/agents/runs', {
      goal: 'Add', model: 'llama-3.1-8b-instant', tools: ['calculator'],
    });
    const run = await waitForTerminal(created.body.id);
    expect(run.status).toBe('done');
    expect(run.steps.find((s: any) => s.kind === 'tool_result').content.result).toBe('4');
    const hookStep = run.steps.find((s: any) => s.kind === 'hook');
    expect(hookStep.content).toMatchObject({ event: 'post_tool', hook: 'flaky-observer', allowed: true });
    expect(hookStep.content.message).toContain('boom');
  });

  it('skips non-matching and disabled hooks', async () => {
    await call('POST', '/api/agents/hooks', {
      name: 'wrong-tool', event: 'pre_tool', toolFilter: 'write_file', command: 'exit 1',
    });
    await call('POST', '/api/agents/hooks', {
      name: 'off', event: 'pre_tool', command: 'exit 1', enabled: false,
    });
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls === 1) return completion(toolCall('c1', 'calculator', { expression: '2 + 2' }));
      return completion({ role: 'assistant', content: 'The answer is 4.' });
    }) as unknown as typeof fetch;

    const created = await call('POST', '/api/agents/runs', {
      goal: 'Add', model: 'llama-3.1-8b-instant', tools: ['calculator'],
    });
    const run = await waitForTerminal(created.body.id);
    expect(run.status).toBe('done');
    expect(run.steps.find((s: any) => s.kind === 'tool_result').content.result).toBe('4');
    expect(run.steps.some((s: any) => s.kind === 'hook')).toBe(false);
  });
});
