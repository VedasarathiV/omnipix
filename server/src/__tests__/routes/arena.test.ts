import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb, getDb } from '../../db/index.js';
import { encrypt } from '../../lib/crypto.js';
import { clearAllCooldowns } from '../../services/ratelimit.js';
import { mintDashboardToken } from '../helpers/auth.js';

// POST /api/arena/run: one prompt fanned out to N pinned models in parallel,
// each isolated so one failure never cancels the others.

const realFetch = globalThis.fetch;
let dashToken = '';

function addKey(platform: string): void {
  const { encrypted, iv, authTag } = encrypt(`test-${platform}-key`);
  getDb().prepare(`
    INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
    VALUES (?, 'arena-test', ?, ?, ?, 'healthy', 1)
  `).run(platform, encrypted, iv, authTag);
}

async function call(app: Express, body: unknown, auth: boolean) {
  const server = app.listen(0, '127.0.0.1');
  if (!server.listening) await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const addr = server.address() as any;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = `Bearer ${dashToken}`;
  const res = await realFetch(`http://127.0.0.1:${addr.port}/api/arena/run`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  server.close();
  return { status: res.status, body: data as any };
}

function completion(model: string, content: string) {
  return new Response(JSON.stringify({
    id: `arena-${model}`, object: 'chat.completion', created: 1, model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

const MODELS = ['llama-3.1-8b-instant', 'gpt-oss-120b'];
const MESSAGES = [{ role: 'user', content: 'Say hi' }];

describe('arena routes', () => {
  let app: Express;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    clearAllCooldowns(Number.MAX_SAFE_INTEGER);
    app = createApp();
    dashToken = mintDashboardToken();
    addKey('groq');
    addKey('cerebras');
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('requires dashboard auth', async () => {
    const { status } = await call(app, { models: MODELS, messages: MESSAGES }, false);
    expect(status).toBe(401);
  });

  it.each([
    [{ models: ['llama-3.1-8b-instant'], messages: MESSAGES }],
    [{ models: ['no-such-model', 'llama-3.1-8b-instant'], messages: MESSAGES }],
    [{ models: ['llama-3.1-8b-instant', 'llama-3.1-8b-instant'], messages: MESSAGES }],
    [{ models: MODELS, messages: [] }],
  ])('rejects invalid requests (%j)', async (body) => {
    const { status } = await call(app, body, true);
    expect(status).toBe(400);
  });

  it('fans out to every model and reports per-model text, latency, and usage', async () => {
    globalThis.fetch = vi.fn(async (url: any) => {
      const host = String(url);
      if (host.includes('groq')) return completion('llama-3.1-8b-instant', 'groq-hi');
      return completion('gpt-oss-120b', 'cerebras-hi');
    }) as unknown as typeof fetch;
    const { status, body } = await call(app, { models: MODELS, messages: MESSAGES, max_tokens: 16 }, true);
    expect(status).toBe(200);
    expect(body.execution_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.results).toHaveLength(2);
    const byModel = Object.fromEntries(body.results.map((r: any) => [r.model, r]));
    expect(byModel['llama-3.1-8b-instant']).toMatchObject({ ok: true, text: 'groq-hi', platform: 'groq' });
    expect(byModel['gpt-oss-120b']).toMatchObject({ ok: true, text: 'cerebras-hi', platform: 'cerebras' });
    for (const r of body.results) {
      expect(r.latencyMs).toBeGreaterThanOrEqual(0);
      expect(r.promptTokens).toBe(10);
      expect(r.completionTokens).toBe(3);
    }
  });

  it('isolates failures: one 429 does not cancel the other model', async () => {
    globalThis.fetch = vi.fn(async (url: any) => {
      if (String(url).includes('groq')) {
        return new Response(JSON.stringify({ error: { message: 'Rate limit' } }), { status: 429, headers: { 'content-type': 'application/json' } });
      }
      return completion('gpt-oss-120b', 'cerebras-hi');
    }) as unknown as typeof fetch;
    const { status, body } = await call(app, { models: MODELS, messages: MESSAGES }, true);
    expect(status).toBe(200);
    const byModel = Object.fromEntries(body.results.map((r: any) => [r.model, r]));
    expect(byModel['llama-3.1-8b-instant'].ok).toBe(false);
    expect(byModel['llama-3.1-8b-instant'].error).toBeTruthy();
    expect(byModel['gpt-oss-120b']).toMatchObject({ ok: true, text: 'cerebras-hi' });
  });
});
