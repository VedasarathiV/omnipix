import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb, getDb } from '../../db/index.js';
import { encrypt } from '../../lib/crypto.js';
import { clearRouterPressure } from '../../services/penalty-inspector.js';
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

function completion(model: string, content: string) {
  return new Response(JSON.stringify({
    id: 'x', object: 'chat.completion', created: 1, model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

async function waitForDone(id: number): Promise<any> {
  for (let i = 0; i < 100; i++) {
    const { body } = await call('GET', `/api/arena/evals/${id}`);
    if (body.status !== 'running') return body;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error('eval did not finish in time');
}

const SUITE = {
  name: 'capitals',
  description: 'Capital cities.',
  items: [
    { id: 'france', prompt: 'Capital of France?', checks: [{ type: 'includes', value: 'Paris' }] },
    { id: 'flat', prompt: 'Is the Earth flat? Answer yes or no first.', checks: [{ type: 'excludes', value: 'yes' }] },
  ],
};

describe('arena evals', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    // Router pressure (cooldowns, penalties, failure windows) is keyed by key
    // id, which restarts at 1 in every fresh :memory: DB — without this, a
    // 500 in one test benches the next test's brand-new key.
    clearRouterPressure();
    app = createApp();
    dashToken = mintDashboardToken();
    addKey('groq');
  });

  afterEach(() => {
    globalThis.fetch = nativeFetch;
    vi.unstubAllGlobals();
  });

  it('lists verify recipes', async () => {
    const { status, body } = await call('GET', '/api/arena/verify-recipes');
    expect(status).toBe(200);
    const names = body.recipes.map((r: { name: string }) => r.name);
    expect(names).toContain('pytest');
    expect(names).toContain('npm-test');
    for (const recipe of body.recipes) {
      expect(recipe.description).toBeTruthy();
      expect(recipe.commands.length).toBeGreaterThan(0);
    }
  });

  it('expands recipes into shell checks on suite create', async () => {
    const { status, body } = await call('POST', '/api/arena/suites', {
      name: 'py-suite',
      description: '',
      items: [{
        id: 't1',
        prompt: 'Make it pass.',
        checks: [{ type: 'includes', value: 'done' }],
        recipes: ['pytest'],
        agent: { files: { 'test_x.py': 'def test_x(): assert True\n' } },
      }],
    });
    expect(status).toBe(201);
    const item = body.suite.items[0];
    expect(item.recipes).toBeUndefined();
    expect(item.checks).toContainEqual({ type: 'shell', value: 'python3 -m pytest -q' });
  });

  it('validates repo sources on items', async () => {
    const base = (repo: unknown) => ({
      name: 'repo-suite',
      items: [{
        id: 't1', prompt: 'Fix it.', checks: [{ type: 'shell', value: 'npm test' }],
        agent: { repo, files: {} },
      }],
    });
    const badUrl = await call('POST', '/api/arena/suites', base({ url: 'git@github.com:x/y.git' }));
    expect(badUrl.status).toBe(400);
    expect(badUrl.body.error.message).toContain('https');
    const badRef = await call('POST', '/api/arena/suites', base({ url: 'https://github.com/x/y.git', ref: '../evil' }));
    expect(badRef.status).toBe(400);
    const badDir = await call('POST', '/api/arena/suites', base({ url: 'https://github.com/x/y.git', dir: '../out' }));
    expect(badDir.status).toBe(400);
    const ok = await call('POST', '/api/arena/suites', base({ url: 'https://github.com/x/y.git', ref: 'v1.0.0' }));
    expect(ok.status).toBe(201);
    expect(ok.body.suite.items[0].agent.repo).toMatchObject({ url: 'https://github.com/x/y.git', ref: 'v1.0.0' });
  });

  it('imports benchmark instances as coding-task items', async () => {
    const { status, body } = await call('POST', '/api/arena/suites/import', {
      name: 'bench-mini',
      description: 'Imported.',
      instances: [{
        id: 'tb-1',
        prompt: 'Make the tests pass.',
        repo: { url: 'https://github.com/x/y.git', ref: 'abc1234' },
        tests: ['python3 -m pytest -q'],
        files: { 'conftest.py': '# seed' },
      }],
    });
    expect(status).toBe(201);
    const [item] = body.suite.items;
    expect(item.checks).toEqual([{ type: 'shell', value: 'python3 -m pytest -q' }]);
    expect(item.agent.repo).toMatchObject({ url: 'https://github.com/x/y.git', ref: 'abc1234' });
    expect(item.agent.files).toEqual({ 'conftest.py': '# seed' });
    expect((await call('POST', '/api/arena/suites/import', {
      name: 'bench-mini', instances: [{ id: 'x', prompt: 'y', tests: ['true'] }],
    })).status).toBe(409);
  });

  it('rejects unknown recipes', async () => {
    const { status, body } = await call('POST', '/api/arena/suites', {
      name: 'bad-recipe',
      items: [{
        id: 't1',
        prompt: 'x',
        checks: [{ type: 'includes', value: 'y' }],
        recipes: ['nope'],
        agent: { files: {} },
      }],
    });
    expect(status).toBe(400);
    expect(body.error.message).toContain('unknown verify recipe');
  });

  it('requires dashboard auth', async () => {
    expect((await call('GET', '/api/arena/suites', undefined, false)).status).toBe(401);
  });

  it('seeds the built-in suites', async () => {
    const { status, body } = await call('GET', '/api/arena/suites');
    expect(status).toBe(200);
    expect(body.suites.map((s: any) => s.name).sort()).toEqual(['safety-basics', 'truthfulness-basics']);
    expect(body.suites[0].items.length).toBeGreaterThan(0);
  });

  it('creates, updates, and deletes a custom suite', async () => {
    const created = await call('POST', '/api/arena/suites', SUITE);
    expect(created.status).toBe(201);
    expect(created.body.suite.items).toHaveLength(2);
    expect((await call('POST', '/api/arena/suites', SUITE)).status).toBe(409);

    const bad = await call('POST', '/api/arena/suites', {
      ...SUITE, name: 'dupes',
      items: [SUITE.items[0], { ...SUITE.items[0] }],
    });
    expect(bad.status).toBe(400);

    const updated = await call('PATCH', '/api/arena/suites/capitals', { description: 'Updated.' });
    expect(updated.status).toBe(200);
    expect(updated.body.suite.description).toBe('Updated.');
    const itemsOnly = await call('PATCH', '/api/arena/suites/capitals', { items: SUITE.items });
    expect(itemsOnly.status).toBe(200);
    expect(itemsOnly.body.suite.description).toBe('Updated.');
    expect((await call('PATCH', '/api/arena/suites/nope', { description: 'x' })).status).toBe(404);

    expect((await call('DELETE', '/api/arena/suites/capitals')).status).toBe(200);
    expect((await call('DELETE', '/api/arena/suites/safety-basics')).status).toBe(403);
  });

  it('runs a suite and grades every item', async () => {
    await call('POST', '/api/arena/suites', SUITE);
    globalThis.fetch = vi.fn(async () => completion('llama-3.1-8b-instant', 'Paris.')) as unknown as typeof fetch;
    const created = await call('POST', '/api/arena/evals', {
      suite: 'capitals', models: ['llama-3.1-8b-instant'],
    });
    expect(created.status).toBe(202);
    const run = await waitForDone(created.body.id);
    expect(run.status).toBe('done');
    expect(run.results).toHaveLength(1);
    expect(run.results[0].model).toBe('llama-3.1-8b-instant');
    // "Paris." passes includes-Paris, and also passes excludes-yes.
    expect(run.results[0].passed).toBe(2);
    expect(run.results[0].items[0].checks[0]).toMatchObject({ type: 'includes', pass: true });
  });

  it('marks model failures as failed items, not failed runs', async () => {
    await call('POST', '/api/arena/suites', SUITE);
    globalThis.fetch = vi.fn(async () => new Response('down', { status: 500 })) as unknown as typeof fetch;
    const created = await call('POST', '/api/arena/evals', {
      suite: 'capitals', models: ['llama-3.1-8b-instant'],
    });
    const run = await waitForDone(created.body.id);
    expect(run.status).toBe('done');
    expect(run.results[0].passed).toBe(0);
    expect(run.results[0].items[0].error).toBeTruthy();
  });

  it('rejects unknown suites and models', async () => {
    expect((await call('POST', '/api/arena/evals', { suite: 'nope', models: ['llama-3.1-8b-instant'] })).status).toBe(400);
    expect((await call('POST', '/api/arena/evals', { suite: 'safety-basics', models: ['no-such-model'] })).status).toBe(400);
    expect((await call('POST', '/api/arena/evals', { suite: 'safety-basics', models: ['a', 'a'] })).status).toBe(400);
    expect((await call('GET', '/api/arena/evals/99999')).status).toBe(404);
  });

  it('serializes eval launches and enforces the daily budget', async () => {
    const guard = await call('GET', '/api/arena/eval-guard');
    expect(guard.body).toMatchObject({ maxRunsPerDay: 10, runsToday: 0, runningIds: [] });

    // A still-running eval blocks new launches with its id.
    getDb().prepare("INSERT INTO eval_runs (suite_id, models_json, status) VALUES (1, '[]', 'running')").run();
    const blocked = await call('POST', '/api/arena/evals', { suite: 'safety-basics', models: ['llama-3.1-8b-instant'] });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.runningIds).toEqual([1]);
    getDb().prepare("UPDATE eval_runs SET status = 'done' WHERE id = 1").run();

    // Daily budget: lower the cap, exhaust it, get 429 with counts.
    expect((await call('PUT', '/api/arena/eval-guard', { maxRunsPerDay: 1 })).status).toBe(200);
    const over = await call('POST', '/api/arena/evals', { suite: 'safety-basics', models: ['llama-3.1-8b-instant'] });
    expect(over.status).toBe(429);
    expect(over.body.error).toMatchObject({ runsToday: 1, maxRunsPerDay: 1 });

    expect((await call('PUT', '/api/arena/eval-guard', { maxRunsPerDay: 0 })).status).toBe(400);
    expect((await call('PUT', '/api/arena/eval-guard', { maxRunsPerDay: 1001 })).status).toBe(400);
  });

  it('aggregates scorecards across finished runs', async () => {
    await call('POST', '/api/arena/suites', SUITE);
    globalThis.fetch = vi.fn(async () => completion('llama-3.1-8b-instant', 'Paris.')) as unknown as typeof fetch;
    const created = await call('POST', '/api/arena/evals', {
      suite: 'capitals', models: ['llama-3.1-8b-instant'],
    });
    await waitForDone(created.body.id);
    const { status, body } = await call('GET', '/api/arena/scorecards');
    expect(status).toBe(200);
    expect(body.scorecards).toHaveLength(1);
    expect(body.scorecards[0]).toMatchObject({
      model: 'llama-3.1-8b-instant', runs: 1, passed: 2, total: 2, passRate: 1,
    });
    expect(body.scorecards[0].suites.capitals).toMatchObject({ runs: 1, passed: 2, total: 2 });
  });
});
