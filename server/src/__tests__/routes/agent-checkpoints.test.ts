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

async function waitForTerminal(id: number): Promise<any> {
  for (let i = 0; i < 200; i++) {
    const { body } = await call('GET', `/api/agents/runs/${id}`);
    if (body.status !== 'running') return body;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error('run did not finish in time');
}

describe('checkpoints', () => {
  beforeEach(async () => {
    await __quiesceAgentRuns();
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    clearRouterPressure();
    __clearRiskOverrides();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omnipix-checkpoints-'));
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

  it('snapshots before file writes and restores on demand', async () => {
    __setRiskOverride('write_file', 'read');
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls <= 2) {
        return completion({
          role: 'assistant', content: '',
          tool_calls: [{ id: `c${calls}`, type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'a.txt', content: `v${calls}` }) } }],
        });
      }
      return completion({ role: 'assistant', content: 'written' });
    }) as unknown as typeof fetch;

    const created = await call('POST', '/api/agents/runs', {
      goal: 'Write a.txt', model: 'llama-3.1-8b-instant', tools: ['write_file'],
    });
    const id = created.body.id;
    const run = await waitForTerminal(id);
    expect(run.status).toBe('done');
    expect(fs.readFileSync(path.join(runWorkspace(id), 'a.txt'), 'utf8')).toBe('v2');

    const listed = await call('GET', `/api/agents/runs/${id}/checkpoints`);
    expect(listed.status).toBe(200);
    // Two auto snapshots, newest first: pre-write #2 (v1), pre-write #1 (empty).
    expect(listed.body.checkpoints).toHaveLength(2);
    expect(listed.body.checkpoints[0].label).toContain('a.txt');

    // Manual snapshot too.
    const manual = await call('POST', `/api/agents/runs/${id}/checkpoints`, { label: 'good state' });
    expect(manual.status).toBe(201);

    // Corrupt the workspace, then rewind to the pre-write-#2 snapshot (v1).
    fs.writeFileSync(path.join(runWorkspace(id), 'a.txt'), 'CORRUPT');
    const restored = await call('POST', `/api/agents/checkpoints/${listed.body.checkpoints[0].id}/restore`);
    expect(restored.status).toBe(200);
    expect(fs.readFileSync(path.join(runWorkspace(id), 'a.txt'), 'utf8')).toBe('v1');
    expect(restored.body.run.steps.map((s: any) => s.kind)).toContain('restore');
    const restoreStep = restored.body.run.steps.find((s: any) => s.kind === 'restore');
    expect(restoreStep.label).toBe('restore');
    expect(restoreStep.content.checkpoint_id).toBe(listed.body.checkpoints[0].id);
  });

  it('refuses to restore under a live run', async () => {
    let release!: (value: Response) => void;
    const gate = new Promise<Response>(resolve => { release = resolve; });
    globalThis.fetch = vi.fn(async () => gate) as unknown as typeof fetch;
    const created = await call('POST', '/api/agents/runs', { goal: 'hang' });
    const id = created.body.id;
    // Wait for the run row to exist as running.
    for (let i = 0; i < 100; i++) {
      const detail = await call('GET', `/api/agents/runs/${id}`);
      if (detail.body.status === 'running') break;
      await new Promise(r => setTimeout(r, 25));
    }
    const snap = await call('POST', `/api/agents/runs/${id}/checkpoints`, { label: 'x' });
    expect(snap.status).toBe(201);
    expect((await call('POST', `/api/agents/checkpoints/${snap.body.checkpoint.id}/restore`)).status).toBe(409);
    release(completion({ role: 'assistant', content: 'done' }));
    await waitForTerminal(id);
  });

  it('validates checkpoint endpoints', async () => {
    expect((await call('GET', '/api/agents/runs/99999/checkpoints')).status).toBe(404);
    expect((await call('GET', '/api/agents/runs/nope/checkpoints')).status).toBe(400);
    expect((await call('POST', '/api/agents/checkpoints/99999/restore')).status).toBe(404);
    expect((await call('POST', '/api/agents/checkpoints/nope/restore')).status).toBe(400);
    expect((await call('GET', '/api/agents/runs/1/checkpoints', undefined, false)).status).toBe(401);
  });
});
