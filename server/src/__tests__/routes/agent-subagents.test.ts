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
import { __quiesceAgentRuns, createAgentRun, getAgentRun } from '../../services/agent-runtime.js';
import { agentToolByName } from '../../services/agent-tools.js';
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

describe('subagents', () => {
  beforeEach(async () => {
    await __quiesceAgentRuns();
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    clearRouterPressure();
    __clearRiskOverrides();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omnipix-subagents-'));
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

  it('delegates a subtask to a child run and reports back', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      // 1: parent delegates. 2-3: child computes. 4: parent answers.
      if (calls === 1) return completion(toolCall('p1', 'delegate', { goal: 'Compute (12+8)/4', tools: ['calculator'] }));
      if (calls === 2) return completion(toolCall('c1', 'calculator', { expression: '(12 + 8) / 4' }));
      if (calls === 3) return completion({ role: 'assistant', content: 'The answer is 5.' });
      return completion({ role: 'assistant', content: 'Child says: 5.' });
    }) as unknown as typeof fetch;

    const created = await call('POST', '/api/agents/runs', {
      goal: 'Get the answer', model: 'llama-3.1-8b-instant', tools: ['delegate', 'calculator'],
    });
    const parent = await waitForTerminal(created.body.id);
    expect(parent.status).toBe('done');
    const report = parent.steps.find((s: any) => s.kind === 'tool_result');
    expect(report.content.result).toContain('[done]');
    expect(report.content.result).toContain('The answer is 5.');

    const childId = Number(/child run (\d+)/.exec(report.content.result)![1]);
    const child = getAgentRun(childId)!;
    expect(child.parent_run_id).toBe(parent.id);
    expect(child.session_id).toBe(parent.session_id);
    expect(child.tools).toEqual(['calculator']);
    expect(child.model).toBe(parent.model);
    expect(child.steps.map(s => s.kind)).toEqual(
      expect.arrayContaining(['tool_call', 'tool_result', 'answer']),
    );
  });

  it('runs the child on an overridden model', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls === 1) return completion(toolCall('p1', 'delegate', {
        goal: 'Say hi', tools: ['calculator'], model: 'llama-3.3-70b-versatile',
      }));
      if (calls === 2) return completion({ role: 'assistant', content: 'hi from the 70b child' });
      return completion({ role: 'assistant', content: 'Child says hi.' });
    }) as unknown as typeof fetch;

    const created = await call('POST', '/api/agents/runs', {
      goal: 'Get a greeting', model: 'llama-3.1-8b-instant', tools: ['delegate', 'calculator'],
    });
    const parent = await waitForTerminal(created.body.id);
    expect(parent.status).toBe('done');
    const report = parent.steps.find((s: any) => s.kind === 'tool_result');
    expect(report.content.result).toContain('[done]');
    const childId = Number(/child run (\d+)/.exec(report.content.result)![1]);
    const child = getAgentRun(childId)!;
    expect(child.model).toBe('llama-3.3-70b-versatile');
  });

  it('rejects an unknown child model as a tool error, without creating a child', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls === 1) return completion(toolCall('p1', 'delegate', { goal: 'x', tools: ['calculator'], model: 'nope-9000' }));
      return completion({ role: 'assistant', content: 'Could not delegate.' });
    }) as unknown as typeof fetch;

    const created = await call('POST', '/api/agents/runs', {
      goal: 'Try a bad model', model: 'llama-3.1-8b-instant', tools: ['delegate', 'calculator'],
    });
    const parent = await waitForTerminal(created.body.id);
    const result = parent.steps.find((s: any) => s.kind === 'tool_result');
    expect(result.content.result).toContain('Unknown or disabled model');
    const children = getDb().prepare('SELECT COUNT(*) AS n FROM agent_runs WHERE parent_run_id = ?').get(parent.id) as { n: number };
    expect(children.n).toBe(0);
  });

  it('shares the parent workspace with the child', async () => {
    __setRiskOverride('write_file', 'read');
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls === 1) return completion(toolCall('p1', 'delegate', { goal: 'Write child.txt' }));
      if (calls === 2) return completion(toolCall('c1', 'write_file', { path: 'child.txt', content: 'from child' }));
      if (calls === 3) return completion({ role: 'assistant', content: 'Wrote it.' });
      return completion({ role: 'assistant', content: 'Delegated.' });
    }) as unknown as typeof fetch;

    const created = await call('POST', '/api/agents/runs', {
      goal: 'Have the child write', model: 'llama-3.1-8b-instant', tools: ['delegate', 'write_file'],
    });
    const parent = await waitForTerminal(created.body.id);
    expect(parent.status).toBe('done');
    // The child's write landed in the PARENT's directory.
    expect(fs.readFileSync(path.join(runWorkspace(parent.id), 'child.txt'), 'utf8')).toBe('from child');
    const report = parent.steps.find((s: any) => s.kind === 'tool_result');
    const childId = Number(/child run (\d+)/.exec(report.content.result)![1]);
    expect(runWorkspace(childId)).toBe(runWorkspace(parent.id));
    // Default child tools: parent's minus delegate.
    expect(getAgentRun(childId)!.tools).toEqual(['write_file']);
  });

  it('parks child approvals in the inbox while the parent waits', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls === 1) return completion(toolCall('p1', 'delegate', { goal: 'Write needy.txt' }));
      if (calls === 2) return completion(toolCall('c1', 'write_file', { path: 'needy.txt', content: 'approved' }));
      return completion({ role: 'assistant', content: 'Wrote it.' });
    }) as unknown as typeof fetch;

    const created = await call('POST', '/api/agents/runs', {
      goal: 'Have the child write', model: 'llama-3.1-8b-instant', tools: ['delegate', 'write_file'],
    });
    const parentId = created.body.id;
    // The child's write parks; the parent stays running behind the delegate call.
    let approval: any = null;
    for (let i = 0; i < 200 && !approval; i++) {
      const pending = await call('GET', '/api/agents/approvals?status=pending');
      approval = pending.body.approvals.find((a: any) => a.tool === 'write_file') ?? null;
      if (!approval) await new Promise(r => setTimeout(r, 25));
    }
    expect(approval).toBeTruthy();
    expect(approval.run_id).not.toBe(parentId);
    expect((await call('GET', `/api/agents/runs/${parentId}`)).body.status).toBe('running');

    const decided = await call('POST', `/api/agents/approvals/${approval.id}/decide`, { approved: true });
    expect(decided.status).toBe(200);
    const parent = await waitForTerminal(parentId);
    expect(parent.status).toBe('done');
    expect(fs.readFileSync(path.join(runWorkspace(parentId), 'needy.txt'), 'utf8')).toBe('approved');
  });

  it('rejects unknown child tools as a tool error, not a dead run', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls === 1) return completion(toolCall('p1', 'delegate', { goal: 'x', tools: ['nuke_everything'] }));
      return completion({ role: 'assistant', content: 'Could not delegate.' });
    }) as unknown as typeof fetch;

    const created = await call('POST', '/api/agents/runs', {
      goal: 'Try a bad delegation', model: 'llama-3.1-8b-instant', tools: ['delegate'],
    });
    const parent = await waitForTerminal(created.body.id);
    expect(parent.status).toBe('done');
    const report = parent.steps.find((s: any) => s.kind === 'tool_result');
    expect(report.content.result).toContain('Unknown tool(s): nuke_everything');
  });

  it('caps delegation depth', async () => {
    const root = createAgentRun({ goal: 'root' });
    const a = createAgentRun({ goal: 'a', parentRunId: root });
    const b = createAgentRun({ goal: 'b', parentRunId: a });
    const c = createAgentRun({ goal: 'c', parentRunId: b });
    const delegate = agentToolByName('delegate')!;
    // Depth 3 (root→a→b→c) may not delegate further.
    await expect(delegate.execute({ goal: 'too deep' }, { runId: c })).rejects.toThrow('depth limit');
    // Invalid maxSteps still validates before any spawn.
    await expect(delegate.execute({ goal: 'x', maxSteps: 99 }, { runId: root })).rejects.toThrow('maxSteps');
    await expect(delegate.execute({}, { runId: root })).rejects.toThrow('missing required string argument: goal');
  });
});
