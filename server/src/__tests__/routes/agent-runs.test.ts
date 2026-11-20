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
// Pinned before tests replace globalThis.fetch with provider mocks.
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

function addKey(platform: string): number {
  const { encrypted, iv, authTag } = encrypt(`${platform}-key`);
  getDb().prepare(
    "INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled) VALUES (?, 'test', ?, ?, ?, 'healthy', 1)",
  ).run(platform, encrypted, iv, authTag);
  const row = getDb().prepare('SELECT last_insert_rowid() AS id').get() as { id: number };
  return row.id;
}

function completion(model: string, message: Record<string, unknown>) {
  return new Response(JSON.stringify({
    id: 'x', object: 'chat.completion', created: 1, model,
    choices: [{ index: 0, message, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

async function waitForTerminal(id: number): Promise<any> {
  for (let i = 0; i < 100; i++) {
    const { body } = await call('GET', `/api/agents/runs/${id}`);
    if (body.status !== 'running') return body;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error('run did not finish in time');
}

describe('agent runs', () => {
  beforeEach(async () => {
    // Quiesce FIRST: a fire-and-forget loop from the previous test must land
    // before its DB is replaced, or it writes into this test's same-id run.
    await __quiesceAgentRuns();
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    // Same key-id-restart bleed as the eval tests: router pressure must not
    // survive the DB it was recorded against.
    clearRouterPressure();
    app = createApp();
    dashToken = mintDashboardToken();
    addKey('groq');
  });

  afterEach(() => {
    globalThis.fetch = nativeFetch;
    vi.unstubAllGlobals();
  });

  it('requires dashboard auth', async () => {
    const { status } = await call('POST', '/api/agents/runs', { goal: 'hi' }, false);
    expect(status).toBe(401);
  });

  it('spotlights tool results as untrusted data in model-bound messages', async () => {
    const bodies: string[] = [];
    let calls = 0;
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      // Only provider calls carry a JSON body; dashboard API calls don't.
      if (init?.body) bodies.push(String(init.body));
      calls++;
      if (calls === 1) {
        return completion('llama-3.1-8b-instant', {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'calculator', arguments: '{"expression":"2 + 2"}' } }],
        });
      }
      return completion('llama-3.1-8b-instant', { role: 'assistant', content: 'The answer is 4.' });
    }) as unknown as typeof fetch;

    const created = await call('POST', '/api/agents/runs', {
      goal: 'What is 2 + 2?', model: 'llama-3.1-8b-instant', tools: ['calculator'],
    });
    const run = await waitForTerminal(created.body.id);
    expect(run.status).toBe('done');
    const secondTurn = bodies.find(b => b.includes('"role":"tool"'));
    expect(secondTurn).toBeDefined();
    // Request bodies are JSON: quotes arrive escaped.
    expect(secondTurn).toContain('<untrusted-data source=\\"calculator\\">');
    expect(secondTurn).toContain('never instructions');
    // The stored trace step keeps raw text for display.
    const stored = run.steps.find((s: any) => s.kind === 'tool_result');
    expect(stored.content.result).not.toContain('untrusted-data');
  });

  it('injects workspace CLAUDE.md into the run system prompt', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omnipix-conventions-'));
    process.env.OMNIPIX_WORKSPACE_ROOT = tmpRoot;
    try {
      // Fresh :memory: DB per test, so this run is id 1; seed its workspace
      // before launch — no race with the fire-and-forget loop.
      const ws = path.join(tmpRoot, 'run-1');
      fs.mkdirSync(ws, { recursive: true });
      fs.writeFileSync(path.join(ws, 'CLAUDE.md'), 'House rule: tabs everywhere.');
      const bodies: string[] = [];
      globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.body) bodies.push(String(init.body));
        return completion('llama-3.1-8b-instant', { role: 'assistant', content: 'Noted.' });
      }) as unknown as typeof fetch;
      const created = await call('POST', '/api/agents/runs', {
        goal: 'Say hi', model: 'llama-3.1-8b-instant', tools: ['calculator'],
      });
      const run = await waitForTerminal(created.body.id);
      expect(run.status).toBe('done');
      expect(bodies[0]).toContain('House rule: tabs everywhere.');
      expect(bodies[0]).toContain('Repository conventions');
    } finally {
      delete process.env.OMNIPIX_WORKSPACE_ROOT;
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('stops at the token budget and reports paid-equivalent cost', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      return completion('llama-3.1-8b-instant', {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: `call_${calls}`, type: 'function', function: { name: 'calculator', arguments: '{"expression":"1 + 1"}' } }],
      });
    }) as unknown as typeof fetch;

    const created = await call('POST', '/api/agents/runs', {
      goal: 'Loop forever', model: 'llama-3.1-8b-instant', tools: ['calculator'], maxSteps: 20, maxTokens: 100,
    });
    expect(created.status).toBe(202);
    const run = await waitForTerminal(created.body.id);
    expect(run.status).toBe('error');
    expect(run.error).toContain('token budget exhausted');
    expect(typeof run.cost_usd).toBe('number');
    expect(run.cost_usd).toBeGreaterThan(0);
    expect(run.prompt_tokens + run.completion_tokens).toBeGreaterThanOrEqual(100);
  });

  it('rejects token budgets outside 100..10M', async () => {
    const base = { goal: 'x', model: 'llama-3.1-8b-instant', tools: ['calculator'] };
    expect((await call('POST', '/api/agents/runs', { ...base, maxTokens: 50 })).status).toBe(400);
    expect((await call('POST', '/api/agents/runs', { ...base, maxTokens: 20_000_000 })).status).toBe(400);
  });

  it('resumes a dead run from its step log with history intact', async () => {
    const { getDb } = await import('../../db/index.js');
    const row = getDb().prepare(
      `INSERT INTO agent_runs (goal, model, tools_json, skills_json, status, error, steps_used, prompt_tokens, completion_tokens)
       VALUES ('What is 2 + 2?', 'llama-3.1-8b-instant', '["calculator"]', '[]', 'error', 'token budget exhausted', 2, 26, 6) RETURNING id`,
    ).get() as { id: number };
    const insert = getDb().prepare('INSERT INTO agent_steps (run_id, seq, kind, name, content_json) VALUES (?, ?, ?, ?, ?)');
    insert.run(row.id, 1, 'tool_call', 'calculator', JSON.stringify({ arguments: { expression: '2 + 2' } }));
    insert.run(row.id, 2, 'tool_result', 'calculator', JSON.stringify({ result: '4' }));

    const bodies: string[] = [];
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.body) bodies.push(String(init.body));
      return completion('llama-3.1-8b-instant', { role: 'assistant', content: 'The answer is 4.' });
    }) as unknown as typeof fetch;

    const resumed = await call('POST', `/api/agents/runs/${row.id}/resume`, {});
    expect(resumed.status).toBe(202);
    const run = await waitForTerminal(row.id);
    expect(run.status).toBe('done');
    expect(run.final_answer).toBe('The answer is 4.');
    // History replayed: the resumed turn saw the earlier tool pair.
    const firstTurn = bodies[0];
    expect(firstTurn).toContain('resumed-1');
    expect(firstTurn).toContain('untrusted-data');
    // Token totals carry over instead of restarting.
    expect(run.prompt_tokens).toBeGreaterThan(26);
    // Trace keeps old steps plus the restore marker and the new answer.
    const kinds = run.steps.map((s: any) => s.kind);
    expect(kinds).toEqual(expect.arrayContaining(['tool_call', 'tool_result', 'restore', 'answer']));
  });

  it('manages persistent approval rules', async () => {
    expect((await call('GET', '/api/agents/approval-rules')).body).toEqual({ rules: [] });
    const created = await call('POST', '/api/agents/approval-rules', { tool: 'shell_exec', decision: 'allow' });
    expect(created.status).toBe(201);
    expect(created.body.rule).toMatchObject({ tool: 'shell_exec', decision: 'allow' });
    expect((await call('POST', '/api/agents/approval-rules', { tool: 'x', decision: 'maybe' })).status).toBe(400);
    const listed = await call('GET', '/api/agents/approval-rules');
    expect(listed.body.rules).toHaveLength(1);
    expect((await call('DELETE', '/api/agents/approval-rules/nope')).status).toBe(404);
    expect((await call('DELETE', '/api/agents/approval-rules/shell_exec')).body).toEqual({ cleared: 'shell_exec' });
    expect((await call('GET', '/api/agents/approval-rules')).body).toEqual({ rules: [] });
  });

  it('refuses to resume live, parked, finished, or missing runs', async () => {
    const { getDb } = await import('../../db/index.js');
    const mk = (status: string) => getDb().prepare(
      `INSERT INTO agent_runs (goal, model, tools_json, skills_json, status) VALUES ('g', 'auto', '[]', '[]', ?) RETURNING id`,
    ).get(status) as { id: number };
    expect((await call('POST', '/api/agents/runs/99999/resume', {})).status).toBe(404);
    expect((await call('POST', `/api/agents/runs/${mk('running').id}/resume`, {})).status).toBe(400);
    expect((await call('POST', `/api/agents/runs/${mk('awaiting_approval').id}/resume`, {})).status).toBe(400);
    expect((await call('POST', `/api/agents/runs/${mk('done').id}/resume`, {})).status).toBe(400);
    expect((await call('POST', '/api/agents/runs/x/resume', {})).status).toBe(400);
  });

  it('validates review requests and lands clone failures loudly', async () => {
    expect((await call('POST', '/api/agents/review', { repo: 'git@x:y.git', base: 'main' })).status).toBe(400);
    expect((await call('POST', '/api/agents/review', { repo: 'https://x.test/y.git' })).status).toBe(400);
    // Unroutable https URL: clone fails fast, run row lands errored, no hang.
    const failed = await call('POST', '/api/agents/review', { repo: 'https://127.0.0.1:9/y.git', base: 'main' });
    expect(failed.status).toBe(502);
    expect(failed.body.error.message).toBeTruthy();
  });

  it.each([
    [{}, 'expected string'],
    [{ goal: '' }, 'Too small'],
    [{ goal: 'x', tools: ['nuke_everything'] }, 'Unknown tool'],
    [{ goal: 'x', skills: ['nope'] }, 'Unknown skill'],
    [{ goal: 'x', model: 'no-such-model' }, 'Unknown or disabled model'],
    [{ goal: 'x', maxSteps: 99 }, '<=25'],
  ])('rejects invalid runs (%j)', async (body, fragment) => {
    const { status, data } = await call('POST', '/api/agents/runs', body).then(r => ({ status: r.status, data: r.body }));
    expect(status).toBe(400);
    expect(data?.error?.message).toContain(fragment);
  });

  it('runs a calculator turn end to end through the router', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls === 1) {
        return completion('llama-3.1-8b-instant', {
          role: 'assistant', content: '',
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'calculator', arguments: '{"expression":"(12 + 8) / 4"}' } }],
        });
      }
      return completion('llama-3.1-8b-instant', { role: 'assistant', content: 'The answer is 5.' });
    }) as unknown as typeof fetch;

    const created = await call('POST', '/api/agents/runs', {
      goal: 'What is (12 + 8) / 4?', model: 'llama-3.1-8b-instant', tools: ['calculator'], maxSteps: 4,
    });
    expect(created.status).toBe(202);
    const run = await waitForTerminal(created.body.id);
    expect(run.status).toBe('done');
    expect(run.final_answer).toBe('The answer is 5.');
    expect(run.steps.map((s: any) => s.kind)).toEqual(['tool_call', 'tool_result', 'thought', 'answer']);
    expect(run.steps[1].content.result).toBe('5');
    expect(run.prompt_tokens).toBeGreaterThan(0);
  });

  it('records an error when the model call fails', async () => {
    globalThis.fetch = vi.fn(async () => new Response('down', { status: 500 })) as unknown as typeof fetch;
    const created = await call('POST', '/api/agents/runs', { goal: 'hi', model: 'llama-3.1-8b-instant' });
    expect(created.status).toBe(202);
    const run = await waitForTerminal(created.body.id);
    expect(run.status).toBe('error');
    expect(run.error).toBeTruthy();
  });

  it('lists runs newest first and 404s unknown ids', async () => {
    const created = await call('POST', '/api/agents/runs', { goal: 'hi' });
    const listed = await call('GET', '/api/agents/runs?limit=5');
    expect(listed.status).toBe(200);
    expect(listed.body.runs.map((r: any) => r.id)).toContain(created.body.id);
    expect((await call('GET', '/api/agents/runs/99999')).status).toBe(404);
    expect((await call('GET', '/api/agents/runs/12abc')).status).toBe(400);
  });

  it('verifies changed files and self-repairs on check failure', async () => {
    // Auto-approve file writes for this loop test (approvals are covered
    // separately); the point here is the verify→retry→verify arc.
    __setRiskOverride('write_file', 'read');
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omnipix-verify-loop-'));
    process.env.OMNIPIX_WORKSPACE_ROOT = tmpRoot;
    try {
      // Next run id is deterministic in a fresh DB: seed its workspace BEFORE
      // the loop starts so no race decides whether checks are detected.
      const nextId = ((getDb().prepare('SELECT COALESCE(MAX(id), 0) AS m FROM agent_runs').get() as { m: number }).m) + 1;
      const ws = runWorkspace(nextId);
      fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({
        scripts: { test: 'node -e "process.exit(require(\'fs\').existsSync(\'fixed.txt\')?0:1)"' },
      }));
      let calls = 0;
      const writeCall = (file: string, content: string) => ({
        role: 'assistant', content: '',
        tool_calls: [{ id: `call_${calls}`, type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: file, content }) } }],
      });
      globalThis.fetch = vi.fn(async () => {
        calls++;
        if (calls === 1) return completion('llama-3.1-8b-instant', writeCall('app.txt', 'v1'));
        if (calls === 2) return completion('llama-3.1-8b-instant', { role: 'assistant', content: 'first draft' });
        if (calls === 3) return completion('llama-3.1-8b-instant', writeCall('fixed.txt', 'repaired'));
        return completion('llama-3.1-8b-instant', { role: 'assistant', content: 'repaired and green' });
      }) as unknown as typeof fetch;

      const created = await call('POST', '/api/agents/runs', {
        goal: 'Ship app.txt with passing tests', model: 'llama-3.1-8b-instant',
        tools: ['write_file'], maxSteps: 10,
      });
      expect(created.status).toBe(202);
      expect(created.body.id).toBe(nextId);
      const run = await waitForTerminal(created.body.id);
      expect(run.status).toBe('done');
      expect(run.final_answer).toBe('repaired and green');
      const kinds = run.steps.map((s: any) => s.kind);
      expect(kinds).toContain('check');
      const checks = run.steps.filter((s: any) => s.kind === 'check');
      expect(checks.map((c: any) => c.content.pass)).toEqual([false, true]);
      expect(fs.existsSync(path.join(ws, 'fixed.txt'))).toBe(true);
    } finally {
      delete process.env.OMNIPIX_WORKSPACE_ROOT;
      __clearRiskOverrides();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('parks MCP tool calls for approval and executes on approve', async () => {
    const script = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'omnipix-mcp-loop-')), 'fake.cjs');
    fs.writeFileSync(script, [
      "const readline = require('readline');",
      "const rl = readline.createInterface({ input: process.stdin, terminal: false });",
      "rl.on('line', (line) => {",
      '  let msg; try { msg = JSON.parse(line); } catch { return; }',
      '  if (msg.id === undefined) return;',
      "  const reply = (result) => console.log(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));",
      "  if (msg.method === 'initialize') { reply({ protocolVersion: msg.params.protocolVersion, capabilities: {}, serverInfo: {} }); return; }",
      "  if (msg.method === 'tools/list') { reply({ tools: [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object' } }] }); return; }",
      "  if (msg.method === 'tools/call') { reply({ content: [{ type: 'text', text: 'echo:' + (msg.params.arguments?.text ?? '') }] }); return; }",
      '});',
    ].join('\n'));
    const registered = await call('POST', '/api/mcp/servers', {
      name: 'fake', transport: 'stdio', command: process.execPath, args: [script],
    });
    expect(registered.status).toBe(201);

    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls === 1) {
        return completion('llama-3.1-8b-instant', {
          role: 'assistant', content: '',
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'mcp:fake:echo', arguments: '{"text":"yo"}' } }],
        });
      }
      return completion('llama-3.1-8b-instant', { role: 'assistant', content: 'Echoed.' });
    }) as unknown as typeof fetch;

    const created = await call('POST', '/api/agents/runs', {
      goal: 'Echo yo', model: 'llama-3.1-8b-instant', tools: ['mcp:fake:echo'],
    });
    expect(created.status).toBe(202);
    const parked = await waitForTerminal(created.body.id);
    expect(parked.status).toBe('awaiting_approval');

    const pending = await call('GET', '/api/agents/approvals?status=pending');
    expect(pending.body.approvals).toHaveLength(1);
    expect(pending.body.approvals[0]).toMatchObject({ tool: 'mcp:fake:echo', risk: 'shell' });
    expect(pending.body.approvals[0].summary).toBe('MCP fake/echo');

    await call('POST', `/api/agents/approvals/${pending.body.approvals[0].id}/decide`, { approved: true });
    const run = await waitForTerminal(created.body.id);
    expect(run.status).toBe('done');
    expect(run.final_answer).toBe('Echoed.');
    expect(run.steps.find((s: any) => s.kind === 'tool_result').content.result).toBe('echo:yo');
  });

  it('rejects MCP tools for unknown or disabled servers', async () => {
    expect((await call('POST', '/api/agents/runs', { goal: 'x', tools: ['mcp:ghost:echo'] })).status).toBe(400);
    expect((await call('POST', '/api/agents/runs', { goal: 'x', tools: ['mcp:broken'] })).status).toBe(400);
    const registered = await call('POST', '/api/mcp/servers', {
      name: 'off', transport: 'stdio', command: 'npx', enabled: false,
    });
    expect(registered.status).toBe(201);
    expect((await call('POST', '/api/agents/runs', { goal: 'x', tools: ['mcp:off:echo'] })).status).toBe(400);
  });

  it('streams persisted steps as SSE for a finished run', async () => {
    globalThis.fetch = vi.fn(async () => completion('x', { role: 'assistant', content: 'done' })) as unknown as typeof fetch;
    const created = await call('POST', '/api/agents/runs', { goal: 'say done', model: 'llama-3.1-8b-instant' });
    const run = await waitForTerminal(created.body.id);
    const server = app.listen(0, '127.0.0.1');
    if (!server.listening) await new Promise<void>(resolve => server.once('listening', () => resolve()));
    const addr = server.address() as { port: number };
    try {
      const res = await nativeFetch(`http://127.0.0.1:${addr.port}/api/agents/runs/${run.id}/events`, {
        headers: { Authorization: `Bearer ${dashToken}` },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      const text = await res.text();
      expect(text).toContain('"type":"step"');
      expect(text).toContain('"type":"done"');
    } finally {
      server.close();
    }
  });
});
