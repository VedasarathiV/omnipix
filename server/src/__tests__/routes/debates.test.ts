import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb, getDb } from '../../db/index.js';
import { encrypt } from '../../lib/crypto.js';
import { mintDashboardToken, isGatedApiPath } from '../helpers/auth.js';

const realFetch = globalThis.fetch;
let app: Express;
let dashToken = '';

function addKey(platform: string): void {
  const { encrypted, iv, authTag } = encrypt(`test-${platform}-key`);
  getDb().prepare(`
    INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
    VALUES (?, 'debate-test', ?, ?, ?, 'healthy', 1)
  `).run(platform, encrypted, iv, authTag);
}

async function call(method: string, path: string, body?: unknown, authed = true) {
  const server = app.listen(0, '127.0.0.1');
  if (!server.listening) await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const addr = server.address() as { port: number };
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authed && isGatedApiPath(path)) headers['Authorization'] = `Bearer ${dashToken}`;
  const res = await realFetch(`http://127.0.0.1:${addr.port}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  server.close();
  return { status: res.status, body: data as any };
}

function completion(model: string, content: string) {
  return new Response(JSON.stringify({
    id: `debate-${model}`, object: 'chat.completion', created: 1, model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

async function waitForDebate(id: number): Promise<any> {
  for (let i = 0; i < 200; i++) {
    const { body } = await call('GET', `/api/arena/debates/${id}`);
    if (body.status !== 'running') return body;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error('debate did not finish in time');
}

const MODELS = ['llama-3.1-8b-instant', 'gpt-oss-120b'];

describe('debates', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    app = createApp();
    dashToken = mintDashboardToken();
    addKey('groq');
    addKey('cerebras');
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('requires dashboard auth', async () => {
    expect((await call('POST', '/api/arena/debates', { prompt: 'x', models: MODELS }, false)).status).toBe(401);
  });

  it('runs rounds with cross-talk and delivers a verdict', async () => {
    const seen: string[] = [];
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: unknown }>; model: string };
      seen.push(JSON.stringify(body.messages));
      if (JSON.stringify(body.messages).includes('You are the judge')) {
        return completion(body.model, 'VERDICT: both agree after debate.');
      }
      return completion(body.model, `answer from ${body.model}`);
    }) as unknown as typeof fetch;

    const created = await call('POST', '/api/arena/debates', {
      prompt: 'Is the sky blue?', models: MODELS, rounds: 2, judge: MODELS[0],
    });
    expect(created.status).toBe(202);
    expect(created.body).toMatchObject({ status: 'running', prompt: 'Is the sky blue?' });

    const done = await waitForDebate(created.body.id);
    expect(done.status).toBe('done');
    expect(done.rounds).toHaveLength(2);
    expect(done.rounds[0].answers.map((a: any) => a.ok)).toEqual([true, true]);
    expect(done.rounds[1].answers.map((a: any) => a.ok)).toEqual([true, true]);
    // Round 2+ feeds each model the other models' previous answers.
    expect(seen.some(s => s.includes('Other models answered'))).toBe(true);
    expect(done.verdict.text).toBe('VERDICT: both agree after debate.');
    expect(done.verdict.judge).toBe(MODELS[0]);

    const listed = await call('GET', '/api/arena/debates');
    expect(listed.body.debates).toHaveLength(1);
  });

  it('rejects bad debate requests', async () => {
    const base = { prompt: 'x', models: MODELS };
    expect((await call('POST', '/api/arena/debates', { ...base, models: ['a'] })).status).toBe(400);
    expect((await call('POST', '/api/arena/debates', { ...base, models: ['a', 'a'] })).status).toBe(400);
    expect((await call('POST', '/api/arena/debates', { ...base, models: [...MODELS, 'a', 'b', 'c'] })).status).toBe(400);
    expect((await call('POST', '/api/arena/debates', { ...base, rounds: 4 })).status).toBe(400);
    expect((await call('POST', '/api/arena/debates', { ...base, models: ['no-such-model', MODELS[1]] })).status).toBe(400);
    expect((await call('POST', '/api/arena/debates', { ...base, judge: 'no-such-model' })).status).toBe(400);
    expect((await call('POST', '/api/arena/debates', { models: MODELS })).status).toBe(400);
    expect((await call('GET', '/api/arena/debates/99999')).status).toBe(404);
    expect((await call('GET', '/api/arena/debates?limit=0')).status).toBe(400);
  });
});
