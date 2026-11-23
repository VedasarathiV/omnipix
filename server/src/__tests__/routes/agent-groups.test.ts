import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb, getDb } from '../../db/index.js';
import { encrypt } from '../../lib/crypto.js';
import { clearRouterPressure } from '../../services/penalty-inspector.js';
import { __quiesceAgentRuns } from '../../services/agent-runtime.js';
import { __quiesceGroups, checkOutputJson, skillsForRole, substituteInputs, toolsForRole, validateGuardrail, validateManagerDecision, validateTaskGraph } from '../../services/agent-orchestrator.js';
import { listRunbooks, resolveRunbook } from '../../services/runbooks.js';
import { groupWorkspace } from '../../lib/workspace.js';
import { __clearRiskOverrides, __setRiskOverride } from '../../lib/agent-policy.js';
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

function addKey(platform: string): void {
  const { encrypted, iv, authTag } = encrypt(`${platform}-key`);
  getDb().prepare(
    "INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled) VALUES (?, 'test', ?, ?, ?, 'healthy', 1)",
  ).run(platform, encrypted, iv, authTag);
}

function completion(message: Record<string, unknown>) {
  return new Response(JSON.stringify({
    id: 'x', object: 'chat.completion', created: 1, model: 'llama-3.1-8b-instant',
    choices: [{ index: 0, message, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

async function waitForGroup(id: number): Promise<any> {
  for (let i = 0; i < 200; i++) {
    const { body } = await call('GET', `/api/agents/groups/${id}`);
    if (body.status !== 'running') return body;
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error('group did not finish in time');
}

describe('agent groups', () => {
  beforeEach(async () => {
    await __quiesceGroups();
    await __quiesceAgentRuns();
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    clearRouterPressure();
    app = createApp();
    dashToken = mintDashboardToken();
    addKey('groq');
  });

  afterEach(() => {
    globalThis.fetch = nativeFetch;
    __clearRiskOverrides();
    vi.unstubAllGlobals();
  });

  it('validates task graphs without touching the model', () => {
    expect(validateTaskGraph([
      { name: 'a', goal: 'do a' },
      { name: 'b', goal: 'do b', dependsOn: [0] },
    ])).toBeNull();
    expect(validateTaskGraph([{ name: 'a', goal: 'x', dependsOn: [3] }])).toContain('unknown task index');
    expect(validateTaskGraph([{ name: 'a', goal: 'x', dependsOn: [0] }])).toContain('itself');
    expect(validateTaskGraph([
      { name: 'a', goal: 'x', dependsOn: [1] },
      { name: 'b', goal: 'x', dependsOn: [0] },
    ])).toContain('cycle');
    expect(validateTaskGraph([{ name: '', goal: 'x' }])).toContain('name');
  });

  it('validates handoff input wiring without touching the model', () => {
    expect(validateTaskGraph([
      { name: 'a', goal: 'do a' },
      { name: 'b', goal: 'do b', dependsOn: [0], inputs: [{ name: 'spec', from: 0 }] },
    ])).toBeNull();
    expect(validateTaskGraph([
      { name: 'a', goal: 'x' },
      { name: 'b', goal: 'x', dependsOn: [0], inputs: [{ name: 'spec', from: 5 }] },
    ])).toContain('unknown task index');
    expect(validateTaskGraph([
      { name: 'a', goal: 'x', inputs: [{ name: 'spec', from: 0 }] },
    ])).toContain('from itself');
    expect(validateTaskGraph([
      { name: 'a', goal: 'x' },
      { name: 'b', goal: 'x', inputs: [{ name: 'spec', from: 0 }] },
    ])).toContain('without depending on it');
    expect(validateTaskGraph([
      { name: 'a', goal: 'x' },
      { name: 'b', goal: 'x', dependsOn: [0], inputs: [{ name: '  ', from: 0 }] },
    ])).toContain('no name');
  });

  it('assigns role tool presets with explicit overrides', () => {
    expect(toolsForRole('reviewer', undefined)).not.toContain('shell_exec');
    expect(toolsForRole('reviewer', undefined)).toContain('read_file');
    expect(toolsForRole('tester', undefined)).toContain('shell_exec');
    expect(toolsForRole('tester', undefined)).not.toContain('write_file');
    expect(toolsForRole('reviewer', ['calculator'])).toEqual(['calculator']);
    expect(toolsForRole('mystery', undefined)).not.toContain('shell_exec');
    expect(skillsForRole('planner')).toEqual(['planner']);
    expect(skillsForRole('Planner')).toEqual(['planner']);
    expect(skillsForRole('code-reviewer')).toEqual(['code-reviewer']);
    expect(skillsForRole('mystery')).toEqual([]);
  });

  it('requires dashboard auth', async () => {
    expect((await call('GET', '/api/agents/groups', undefined, false)).status).toBe(401);
  });

  it('runs a two-task graph respecting dependencies', async () => {
    globalThis.fetch = vi.fn(async () => completion({ role: 'assistant', content: 'task done' })) as unknown as typeof fetch;
    const created = await call('POST', '/api/agents/groups', {
      goal: 'Ship the thing',
      tasks: [
        { name: 'build', role: 'coder', goal: 'Build it' },
        { name: 'check', role: 'reviewer', goal: 'Review it', dependsOn: [0] },
      ],
    });
    expect(created.status).toBe(202);
    expect(created.body.tasks.map((t: any) => t.name)).toEqual(['build', 'check']);
    const group = await waitForGroup(created.body.id);
    expect(group.status).toBe('done');
    expect(group.tasks.map((t: any) => t.status)).toEqual(['done', 'done']);
    expect(group.tasks[0].result_summary).toBe('task done');
    expect(group.tokens_used).toBeGreaterThan(0);
    expect(group.session_id).toBeTruthy();
    expect(group.workspace).toBe(`group-${created.body.id}`);
    expect(group.git_branch).toBeNull();
  });

  it('lets tasks collaborate through the shared workspace', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omnipix-group-share-'));
    process.env.OMNIPIX_WORKSPACE_ROOT = tmpRoot;
    __setRiskOverride('write_file', 'read');
    try {
      // Route by goal text: deterministic under any interleaving, since the
      // mock answers from the request body instead of a call counter.
      globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: unknown }> };
        const text = JSON.stringify(body.messages);
        if (text.includes('Write the number')) {
          const last = body.messages[body.messages.length - 1];
          if (JSON.stringify(last).includes('tool')) {
            return completion({ role: 'assistant', content: 'wrote it' });
          }
          return completion({
            role: 'assistant', content: '',
            tool_calls: [{ id: 'c1', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'answer.txt', content: '42' }) } }],
          });
        }
        const last = body.messages[body.messages.length - 1];
        if (JSON.stringify(last).includes('tool')) {
          return completion({ role: 'assistant', content: 'the file says 42' });
        }
        return completion({
          role: 'assistant', content: '',
          tool_calls: [{ id: 'c2', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: 'answer.txt' }) } }],
        });
      }) as unknown as typeof fetch;
      const created = await call('POST', '/api/agents/groups', {
        goal: 'Share 42',
        tasks: [
          { name: 'writer', role: 'coder', goal: 'Write the number into answer.txt' },
          { name: 'reader', role: 'coder', goal: 'Read the number from answer.txt', dependsOn: [0] },
        ],
      });
      const group = await waitForGroup(created.body.id);
      expect(group.status).toBe('done');
      expect(group.tasks[1].result_summary).toContain('42');
      expect(fs.readFileSync(path.join(tmpRoot, `group-${created.body.id}`, 'answer.txt'), 'utf8')).toBe('42');
    } finally {
      delete process.env.OMNIPIX_WORKSPACE_ROOT;
      __clearRiskOverrides();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('retries failed tasks then skips their dependents', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      // Every model call fails: task 0 exhausts retries, task 1 skips.
      return new Response('down', { status: 500 });
    }) as unknown as typeof fetch;
    const created = await call('POST', '/api/agents/groups', {
      goal: 'Doomed',
      tasks: [
        { name: 'first', role: 'coder', goal: 'Fail', maxAttempts: 1 },
        { name: 'second', role: 'coder', goal: 'Never runs', dependsOn: [0] },
      ],
    });
    const group = await waitForGroup(created.body.id);
    expect(group.status).toBe('error');
    expect(group.tasks.map((t: any) => t.status)).toEqual(['error', 'skipped']);
    expect(calls).toBeGreaterThan(0);
  });

  it('stops live groups and deletes with cascade', async () => {
    // Gated model: the run stays in-flight until the test releases it, so
    // stop is observed while the loop is provably alive.
    let release!: (value: Response) => void;
    const gate = new Promise<Response>(resolve => { release = resolve; });
    globalThis.fetch = vi.fn(async () => gate) as unknown as typeof fetch;
    const grouped = await call('POST', '/api/agents/groups', {
      goal: 'Stuck', tasks: [{ name: 'only', role: 'coder', goal: 'Hang' }],
    });
    // Wait for the task run to exist before stopping.
    for (let i = 0; i < 100; i++) {
      const detail = await call('GET', `/api/agents/groups/${grouped.body.id}`);
      if (detail.body.tasks[0].run_id != null) break;
      await new Promise(r => setTimeout(r, 50));
    }
    const stopped = await call('POST', `/api/agents/groups/${grouped.body.id}/stop`);
    expect(stopped.status).toBe(200);
    release(completion({ role: 'assistant', content: 'too late' }));
    const group = await waitForGroup(grouped.body.id);
    expect(group.status).toBe('stopped');
    expect((await call('DELETE', `/api/agents/groups/${grouped.body.id}`)).status).toBe(200);
    expect((await call('GET', `/api/agents/groups/${grouped.body.id}`)).status).toBe(404);
    expect((await call('POST', '/api/agents/groups/99999/stop')).status).toBe(404);
  });

  it('resumes stopped groups and refuses live or finished ones', async () => {
    let release!: (value: Response) => void;
    const gate = new Promise<Response>(resolve => { release = resolve; });
    globalThis.fetch = vi.fn(async () => gate) as unknown as typeof fetch;
    const grouped = await call('POST', '/api/agents/groups', {
      goal: 'Pausable', tasks: [{ name: 'only', role: 'coder', goal: 'Hang then finish' }],
    });
    // Live group: resume is a conflict, not a second driver.
    expect((await call('POST', `/api/agents/groups/${grouped.body.id}/resume`)).status).toBe(409);
    expect((await call('POST', '/api/agents/groups/99999/resume')).status).toBe(404);
    for (let i = 0; i < 100; i++) {
      const detail = await call('GET', `/api/agents/groups/${grouped.body.id}`);
      if (detail.body.tasks[0].run_id != null) break;
      await new Promise(r => setTimeout(r, 50));
    }
    expect((await call('POST', `/api/agents/groups/${grouped.body.id}/stop`)).status).toBe(200);
    release(completion({ role: 'assistant', content: 'too late' }));
    const stopped = await waitForGroup(grouped.body.id);
    expect(stopped.status).toBe('stopped');
    // Resume requeues the stopped task and drives it to done.
    globalThis.fetch = vi.fn(async () => completion({ role: 'assistant', content: 'finished after resume' })) as unknown as typeof fetch;
    const resumed = await call('POST', `/api/agents/groups/${grouped.body.id}/resume`);
    expect(resumed.status).toBe(202);
    expect(resumed.body.status).toBe('running');
    const done = await waitForGroup(grouped.body.id);
    expect(done.status).toBe('done');
    expect(done.tasks[0].result_summary).toBe('finished after resume');
    // Finished group: nothing to resume.
    expect((await call('POST', `/api/agents/groups/${grouped.body.id}/resume`)).status).toBe(409);
  });

  it('auto-plans a graph from the goal through the model', async () => {
    globalThis.fetch = vi.fn(async () => completion({
      role: 'assistant',
      content: JSON.stringify([
        { name: 'plan', role: 'planner', goal: 'Plan it', dependsOn: [] },
        { name: 'build', role: 'coder', goal: 'Build it', dependsOn: [0] },
      ]),
    })) as unknown as typeof fetch;
    const created = await call('POST', '/api/agents/groups', { goal: 'Ship it', auto: true });
    expect(created.status).toBe(202);
    expect(created.body.tasks.map((t: any) => t.name)).toEqual(['plan', 'build']);
    const group = await waitForGroup(created.body.id);
    expect(group.status).toBe('done');
  });

  it('rejects bad plans and malformed planner output', async () => {
    expect((await call('POST', '/api/agents/groups', { goal: 'x' })).status).toBe(400);
    expect((await call('POST', '/api/agents/groups', {
      goal: 'x', tasks: [{ name: 'a', goal: 'y', dependsOn: [5] }],
    })).status).toBe(400);
    globalThis.fetch = vi.fn(async () => completion({ role: 'assistant', content: 'not json' })) as unknown as typeof fetch;
    expect((await call('POST', '/api/agents/groups', { goal: 'x', auto: true })).status).toBe(502);
    expect((await call('GET', '/api/agents/groups/12abc')).status).toBe(400);
  });

  it('stores contracts and rejects bad wiring', async () => {
    globalThis.fetch = vi.fn(async () => completion({ role: 'assistant', content: 'ok' })) as unknown as typeof fetch;
    const created = await call('POST', '/api/agents/groups', {
      goal: 'Contracted', tasks: [
        { name: 'spec', role: 'planner', goal: 'Write spec', expectedOutput: 'A spec doc.' },
        {
          name: 'build', role: 'coder', goal: 'Build it', dependsOn: [0],
          expectedOutput: 'Working code.', inputs: [{ name: 'spec', from: 0 }],
        },
      ],
    });
    expect(created.status).toBe(202);
    expect(created.body.tasks[0].expected_output).toBe('A spec doc.');
    expect(created.body.tasks[1].inputs).toEqual([{ name: 'spec', from: created.body.tasks[0].id }]);
    expect((await call('POST', '/api/agents/groups', {
      goal: 'x', tasks: [
        { name: 'a', goal: 'y' },
        { name: 'b', goal: 'z', inputs: [{ name: 'spec', from: 0 }] },
      ],
    })).status).toBe(400);
    await waitForGroup(created.body.id);
  });

  it('records handoffs and renders wired inputs downstream', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls === 1) {
        return completion({
          role: 'assistant', content: '',
          tool_calls: [{
            id: 'c1', type: 'function',
            function: { name: 'blackboard_write', arguments: JSON.stringify({ key: 'api-shape', value: 'REST with /v1' }) },
          }],
        });
      }
      return completion({ role: 'assistant', content: 'task done' });
    }) as unknown as typeof fetch;
    const created = await call('POST', '/api/agents/groups', {
      goal: 'Handoff flow', tasks: [
        { name: 'spec', role: 'planner', goal: 'Write spec', expectedOutput: 'A spec doc.' },
        {
          name: 'build', role: 'coder', goal: 'Build it', dependsOn: [0],
          expectedOutput: 'Working code.', inputs: [{ name: 'spec', from: 0 }],
        },
      ],
    });
    const group = await waitForGroup(created.body.id);
    expect(group.status).toBe('done');
    const [spec, build] = group.tasks;
    expect(spec.handoff).toMatchObject({ summary: 'task done', expected_output: 'A spec doc.' });
    expect(spec.handoff.outputs).toMatchObject({ 'api-shape': 'REST with /v1' });
    const run = await call('GET', `/api/agents/runs/${build.run_id}`);
    expect(run.body.goal).toContain('Expected output (your work is done when this holds):');
    expect(run.body.goal).toContain('Working code.');
    expect(run.body.goal).toContain('Handoff inputs from finished teammates');
    expect(run.body.goal).toContain('### Input "spec" (from task spec #');
    expect(run.body.goal).toContain('REST with /v1');
  });

  it('auto-plans expected outputs through the model', async () => {
    globalThis.fetch = vi.fn(async () => completion({
      role: 'assistant',
      content: JSON.stringify([
        { name: 'plan', role: 'planner', goal: 'Plan it', dependsOn: [], expectedOutput: 'A plan.' },
        { name: 'build', role: 'coder', goal: 'Build it', dependsOn: [0], expectedOutput: 'Code.' },
      ]),
    })) as unknown as typeof fetch;
    const created = await call('POST', '/api/agents/groups', { goal: 'Ship it', auto: true });
    expect(created.status).toBe(202);
    expect(created.body.tasks.map((t: any) => t.expected_output)).toEqual(['A plan.', 'Code.']);
    const group = await waitForGroup(created.body.id);
    expect(group.status).toBe('done');
  });

  it('validates manager decisions without touching the model', () => {
    const tasks = [
      { id: 1, name: 'spec', status: 'done' },
      { id: 2, name: 'build', status: 'running' },
    ];
    const good = {
      action: 'spawn', reason: 'Need code.',
      task: {
        name: 'build', role: 'coder', goal: 'Build it', expectedOutput: 'Code.',
        tools: ['calculator'], inputs: [{ name: 'spec', fromTaskId: 1 }],
      },
    };
    expect(validateManagerDecision(tasks, good)).toEqual({
      decision: {
        action: 'spawn', reason: 'Need code.',
        task: {
          name: 'build', role: 'coder', goal: 'Build it', expectedOutput: 'Code.',
          tools: ['calculator'], inputs: [{ name: 'spec', fromTaskId: 1 }], maxAttempts: undefined,
        },
      },
    });
    expect(validateManagerDecision(tasks, { action: 'finish', reason: 'Done.' })).toEqual({
      decision: { action: 'finish', reason: 'Done.' },
    });
    expect(validateManagerDecision(tasks, 'nope')).toMatchObject({ error: expect.stringContaining('JSON object') });
    expect(validateManagerDecision(tasks, { action: 'dance', reason: 'x' })).toMatchObject({ error: expect.stringContaining('spawn') });
    expect(validateManagerDecision(tasks, { action: 'finish', reason: '' })).toMatchObject({ error: expect.stringContaining('reason') });
    expect(validateManagerDecision(tasks, { action: 'spawn', reason: 'x' })).toMatchObject({ error: expect.stringContaining('task object') });
    expect(validateManagerDecision(tasks, { action: 'spawn', reason: 'x', task: { name: '', goal: 'g' } }))
      .toMatchObject({ error: expect.stringContaining('name') });
    expect(validateManagerDecision(tasks, { action: 'spawn', reason: 'x', task: { name: 'a', goal: 'g', role: 'wizard' } }))
      .toMatchObject({ error: expect.stringContaining('role') });
    expect(validateManagerDecision(tasks, {
      action: 'spawn', reason: 'x',
      task: { name: 'a', goal: 'g', inputs: [{ name: 's', fromTaskId: 99 }] },
    })).toMatchObject({ error: expect.stringContaining('unknown task') });
    expect(validateManagerDecision(tasks, {
      action: 'spawn', reason: 'x',
      task: { name: 'a', goal: 'g', inputs: [{ name: 's', fromTaskId: 2 }] },
    })).toMatchObject({ error: expect.stringContaining('not done') });
    expect(validateManagerDecision(tasks, {
      action: 'spawn', reason: 'x',
      task: { name: 'a', goal: 'g', tools: ['nuke_everything'] },
    })).toMatchObject({ error: expect.stringContaining('unknown tool') });
  });

  it('runs a hierarchical group end to end through the manager', async () => {
    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = String(init?.body ?? '');
      if (!body.includes('You manage a team')) {
        return completion({ role: 'assistant', content: 'task done' });
      }
      const doneIds = [...body.matchAll(/#(\d+) \S+ \[\w+\] done/g)].map(m => Number(m[1]));
      if (doneIds.length === 0) {
        return completion({
          role: 'assistant',
          content: JSON.stringify({
            action: 'spawn', reason: 'Start with a spec.',
            task: { name: 'spec', role: 'planner', goal: 'Write spec', expectedOutput: 'A spec.' },
          }),
        });
      }
      if (doneIds.length === 1) {
        return completion({
          role: 'assistant',
          content: JSON.stringify({
            action: 'spawn', reason: 'Build from the spec.',
            task: {
              name: 'build', role: 'coder', goal: 'Build it', expectedOutput: 'Code.',
              inputs: [{ name: 'spec', fromTaskId: doneIds[0] }],
            },
          }),
        });
      }
      return completion({
        role: 'assistant', content: JSON.stringify({ action: 'finish', reason: 'Goal achieved.' }),
      });
    }) as unknown as typeof fetch;

    const created = await call('POST', '/api/agents/groups', { goal: 'Ship it', mode: 'hierarchical' });
    expect(created.status).toBe(202);
    expect(created.body.mode).toBe('hierarchical');
    expect(created.body.tasks).toHaveLength(0);
    const group = await waitForGroup(created.body.id);
    expect(group.status).toBe('done');
    expect(group.tasks.map((t: any) => t.name)).toEqual(['spec', 'build']);
    expect(group.tasks[1].inputs).toEqual([{ name: 'spec', from: group.tasks[0].id }]);
    expect(group.tasks[1].dependsOn).toEqual([group.tasks[0].id]);
    expect(group.manager_decisions).toBe(3);
    expect(group.tokens_used).toBeGreaterThan(0);
    const boardKeys = group.blackboard.map((e: any) => e.key);
    expect(boardKeys).toContain('manager/finish');
  });

  it('records rejected manager decisions without stalling', async () => {
    let managerCalls = 0;
    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = String(init?.body ?? '');
      if (!body.includes('You manage a team')) {
        return completion({ role: 'assistant', content: 'task done' });
      }
      managerCalls++;
      if (managerCalls === 1) return completion({ role: 'assistant', content: 'not json at all' });
      return completion({
        role: 'assistant', content: JSON.stringify({ action: 'finish', reason: 'Nothing to do.' }),
      });
    }) as unknown as typeof fetch;
    const created = await call('POST', '/api/agents/groups', { goal: 'Empty', mode: 'hierarchical' });
    const group = await waitForGroup(created.body.id);
    expect(group.status).toBe('done');
    expect(group.manager_decisions).toBe(2);
    const rejection = group.blackboard.find((e: any) => e.key === 'manager/last-rejection');
    expect(rejection.value).toContain('malformed JSON');
  });

  it('validates hierarchical creation', async () => {
    globalThis.fetch = vi.fn(async () => completion({ role: 'assistant', content: 'ok' })) as unknown as typeof fetch;
    expect((await call('POST', '/api/agents/groups', { goal: 'x', mode: 'mesh' })).status).toBe(400);
    expect((await call('POST', '/api/agents/groups', { goal: 'x' })).status).toBe(400);
    const dag = await call('POST', '/api/agents/groups', {
      goal: 'x', tasks: [{ name: 'a', goal: 'y' }],
    });
    expect(dag.body.mode).toBe('dag');
    await waitForGroup(dag.body.id);
  });

  it('validates guardrail specs without touching the model', () => {
    expect(validateGuardrail({ type: 'llm_judge', prompt: 'Be good.' })).toBeNull();
    expect(validateGuardrail({ type: 'shell', command: 'npm test' })).toBeNull();
    expect(validateGuardrail('nope')).toContain('object');
    expect(validateGuardrail({ type: 'vibes' })).toContain('llm_judge');
    expect(validateGuardrail({ type: 'shell' })).toContain('command');
    expect(validateTaskGraph([{ name: 'a', goal: 'x', guardrail: { type: 'shell' } }])).toContain('command');
  });

  it('lands shell guardrail verdicts and fails terminally', async () => {
    globalThis.fetch = vi.fn(async () => completion({ role: 'assistant', content: 'task done' })) as unknown as typeof fetch;
    const created = await call('POST', '/api/agents/groups', {
      goal: 'Shell QA', tasks: [
        { name: 'good', goal: 'Pass the check', guardrail: { type: 'shell', command: 'exit 0' } },
        { name: 'bad', goal: 'Fail the check', maxAttempts: 1, guardrail: { type: 'shell', command: 'exit 3' } },
        { name: 'downstream', goal: 'Never runs', dependsOn: [1] },
      ],
    });
    const group = await waitForGroup(created.body.id);
    expect(group.status).toBe('error');
    const [good, bad, downstream] = group.tasks;
    expect(good.status).toBe('done');
    expect(good.verdict).toMatchObject({ pass: true, kind: 'shell' });
    expect(good.handoff.verdict.pass).toBe(true);
    expect(bad.status).toBe('error');
    expect(bad.verdict).toMatchObject({ pass: false, kind: 'shell' });
    expect(bad.error).toContain('QA verdict: FAIL');
    expect(downstream.status).toBe('skipped');
  });

  it('retries on judge FAIL with the reason fed back, then lands', async () => {
    let judges = 0;
    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = String(init?.body ?? '');
      if (!body.includes('QA judge')) {
        return completion({ role: 'assistant', content: 'task done' });
      }
      judges++;
      if (judges === 1) return completion({ role: 'assistant', content: 'FAIL\n\nMissing the required summary section.' });
      return completion({ role: 'assistant', content: 'PASS\n\nAll criteria met.' });
    }) as unknown as typeof fetch;
    const created = await call('POST', '/api/agents/groups', {
      goal: 'Judge QA', tasks: [
        {
          name: 'write', goal: 'Write it', maxAttempts: 3,
          expectedOutput: 'A doc with a summary section.',
          guardrail: { type: 'llm_judge' },
        },
      ],
    });
    const group = await waitForGroup(created.body.id);
    expect(group.status).toBe('done');
    const [task] = group.tasks;
    expect(task.attempts).toBe(2);
    expect(task.verdict).toMatchObject({ pass: true, kind: 'llm_judge' });
    expect(task.verdict.reason).toContain('All criteria met');
    // The retry run saw the previous verdict in its goal.
    const run = await call('GET', `/api/agents/runs/${task.run_id}`);
    expect(run.body.goal).toContain('Previous attempt FAILED QA (llm_judge)');
    expect(run.body.goal).toContain('Missing the required summary section');
  });

  it('ships valid runbook presets', () => {
    const runbooks = listRunbooks();
    expect(runbooks.map(r => r.name).sort()).toEqual(['code-review', 'incident-response', 'research-sweep', 'startup-mvp']);
    for (const runbook of runbooks) {
      const tasks = resolveRunbook(runbook.name, 'Build a widget API')!;
      expect(validateTaskGraph(tasks)).toBeNull();
      expect(tasks.every(t => t.goal.includes('Build a widget API') || !t.goal.includes('{{goal}}'))).toBe(true);
      expect(tasks.some(t => t.expectedOutput)).toBe(true);
    }
    expect(resolveRunbook('nope', 'x')).toBeNull();
    expect(resolveRunbook('  STARTUP-MVP  ', 'x')!.map(t => t.name)).toEqual(['spec', 'build', 'review', 'verify']);
  });

  it('creates groups from presets and rejects bad combos', async () => {
    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = String(init?.body ?? '');
      if (body.includes('QA judge')) return completion({ role: 'assistant', content: 'PASS\n\nGood.' });
      return completion({ role: 'assistant', content: 'task done' });
    }) as unknown as typeof fetch;
    const created = await call('POST', '/api/agents/groups', { goal: 'Ship a widget', preset: 'startup-mvp' });
    expect(created.status).toBe(202);
    expect(created.body.tasks.map((t: any) => t.name)).toEqual(['spec', 'build', 'review', 'verify']);
    expect(created.body.tasks[0].goal).toContain('Ship a widget');
    expect(created.body.tasks[1].inputs).toEqual([{ name: 'spec', from: created.body.tasks[0].id }]);
    const group = await waitForGroup(created.body.id);
    expect(group.status).toBe('done');

    const listed = await call('GET', '/api/agents/runbooks');
    expect(listed.body.runbooks.map((r: any) => r.name).sort()).toEqual(['code-review', 'incident-response', 'research-sweep', 'startup-mvp']);

    expect((await call('POST', '/api/agents/groups', { goal: 'x', preset: 'nope' })).status).toBe(400);
    expect((await call('POST', '/api/agents/groups', {
      goal: 'x', preset: 'startup-mvp', tasks: [{ name: 'a', goal: 'y' }],
    })).status).toBe(400);
    expect((await call('GET', '/api/agents/runbooks', undefined, false)).status).toBe(401);
  });

  it('checks JSON validity and substitutes inputs without touching the model', () => {
    expect(checkOutputJson({ output_json: 0 }, 'nope')).toBeNull();
    expect(checkOutputJson({ output_json: 1 }, '{"a":1}')).toMatchObject({ pass: true, kind: 'json' });
    expect(checkOutputJson({ output_json: 1 }, 'nope')).toMatchObject({ pass: false, kind: 'json' });

    const out = { goal: '', tasks: [] as any[] };
    expect(substituteInputs(
      'Ship {{app}}',
      [{ name: 'a', goal: 'Build {{app}} for {{owner}}', expectedOutput: '{{app}} works' }],
      { app: 'Widget', owner: 'Acme' },
      out,
    )).toBeNull();
    expect(out.goal).toBe('Ship Widget');
    expect(out.tasks[0].goal).toBe('Build Widget for Acme');
    expect(out.tasks[0].expectedOutput).toBe('Widget works');
    expect(substituteInputs('Ship {{app}}', [], {}, { goal: '', tasks: [] })).toContain('Unknown input: {{app}}');
    expect(validateTaskGraph([{ name: 'a', goal: 'x', outputFile: '../escape.txt' }])).toContain('escapes the workspace');
  });

  it('gates landing on JSON and writes output files', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls === 1) return completion({ role: 'assistant', content: 'not json at all' });
      return completion({ role: 'assistant', content: '{"status":"ok"}' });
    }) as unknown as typeof fetch;
    const created = await call('POST', '/api/agents/groups', {
      goal: 'JSON outs', tasks: [
        { name: 'emit', goal: 'Emit JSON', maxAttempts: 3, outputJson: true, outputFile: 'out/result.json' },
      ],
    });
    const group = await waitForGroup(created.body.id);
    expect(group.status).toBe('done');
    const [task] = group.tasks;
    expect(task.attempts).toBe(2);
    expect(task.verdict).toMatchObject({ pass: true, kind: 'json' });
    expect(fs.readFileSync(path.join(groupWorkspace(group.id), 'out/result.json'), 'utf8')).toBe('{"status":"ok"}');
  });

  it('substitutes kickoff inputs and rejects unknown placeholders', async () => {
    globalThis.fetch = vi.fn(async () => completion({ role: 'assistant', content: 'ok' })) as unknown as typeof fetch;
    const created = await call('POST', '/api/agents/groups', {
      goal: 'Ship {{app}}',
      tasks: [{ name: 'build', goal: 'Build {{app}} now' }],
      inputs: { app: 'Widget' },
    });
    expect(created.status).toBe(202);
    expect(created.body.goal).toBe('Ship Widget');
    expect(created.body.tasks[0].goal).toBe('Build Widget now');
    await waitForGroup(created.body.id);
    expect((await call('POST', '/api/agents/groups', {
      goal: 'Ship {{app}}', tasks: [{ name: 'a', goal: 'x' }], inputs: { other: 'y' },
    })).status).toBe(400);
  });

  it('pins operator notes to the blackboard', async () => {
    globalThis.fetch = vi.fn(async () => completion({ role: 'assistant', content: 'ok' })) as unknown as typeof fetch;
    const created = await call('POST', '/api/agents/groups', {
      goal: 'Noted', tasks: [{ name: 'only', role: 'coder', goal: 'Work' }],
    });
    const noted = await call('POST', `/api/agents/groups/${created.body.id}/blackboard`, {
      key: 'direction', value: 'use tabs',
    });
    expect(noted.status).toBe(201);
    expect(noted.body.blackboard).toMatchObject([{ key: 'direction', value: 'use tabs', writerTaskId: null }]);
    expect((await call('POST', '/api/agents/groups/99999/blackboard', { key: 'k', value: 'v' })).status).toBe(404);
    await waitForGroup(created.body.id);
  });
});
