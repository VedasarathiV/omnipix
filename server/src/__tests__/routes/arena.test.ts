import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb, getDb } from '../../db/index.js';
import { encrypt } from '../../lib/crypto.js';
import { clearAllCooldowns } from '../../services/ratelimit.js';
import { runModelCall } from '../../services/fusion.js';
import { mintDashboardToken } from '../helpers/auth.js';

// Real runner by default; individual tests override per-call behavior.
vi.mock('../../services/fusion.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../services/fusion.js')>();
  return { ...mod, runModelCall: vi.fn((...args: unknown[]) => (mod.runModelCall as (...a: any[]) => unknown)(...args)) };
});

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
    { name: 'one model', body: { models: ['llama-3.1-8b-instant'], messages: MESSAGES }, message: '>=2 items' },
    { name: 'unknown id', body: { models: ['no-such-model', 'llama-3.1-8b-instant'], messages: MESSAGES }, message: 'Unknown or disabled model(s)' },
    { name: 'duplicate ids', body: { models: ['llama-3.1-8b-instant', 'llama-3.1-8b-instant'], messages: MESSAGES }, message: 'Duplicate model ids' },
    { name: 'no messages', body: { models: MODELS, messages: [] }, message: '>=1 items' },
    { name: 'seven models', body: { models: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], messages: MESSAGES }, message: '<=6 items' },
    { name: '101 messages', body: { models: MODELS, messages: Array.from({ length: 101 }, () => ({ role: 'user', content: 'x' })) }, message: '<=100 items' },
    { name: 'max_tokens 0', body: { models: MODELS, messages: MESSAGES, max_tokens: 0 }, message: '>=1' },
    { name: 'max_tokens 200000', body: { models: MODELS, messages: MESSAGES, max_tokens: 200000 }, message: '<=128000' },
    { name: 'temperature -1', body: { models: MODELS, messages: MESSAGES, temperature: -1 }, message: '>=0' },
    { name: 'temperature 3', body: { models: MODELS, messages: MESSAGES, temperature: 3 }, message: '<=2' },
  ])('rejects $name with the right validator', async ({ body, message }) => {
    const { status, body: data } = await call(app, body, true);
    expect(status).toBe(400);
    expect(data?.error?.message).toContain(message);
  });

  it('accepts boundary-valid inputs', async () => {
    globalThis.fetch = vi.fn(async () => completion('x', 'edge')) as unknown as typeof fetch;
    const ids = (getDb().prepare('SELECT DISTINCT model_id AS id FROM models WHERE enabled = 1 LIMIT 6').all() as { id: string }[]).map(r => r.id);
    expect(ids).toHaveLength(6);
    const messages = Array.from({ length: 100 }, () => ({ role: 'user', content: 'x' }));
    for (const extra of [{ temperature: 0, max_tokens: 1 }, { temperature: 2, max_tokens: 128000 }]) {
      const { status, body } = await call(app, { models: ids, messages, ...extra }, true);
      expect(status).toBe(200);
      expect(body.results).toHaveLength(6);
    }
  });

  it('rejects a disabled-but-known model id', async () => {
    getDb().prepare("UPDATE models SET enabled = 0 WHERE model_id = 'gpt-oss-120b'").run();
    const { status, body } = await call(app, { models: MODELS, messages: MESSAGES }, true);
    expect(status).toBe(400);
    expect(body.error.message).toContain('gpt-oss-120b');
  });

  it('accepts array content messages', async () => {
    globalThis.fetch = vi.fn(async () => completion('x', 'array-hi')) as unknown as typeof fetch;
    const messages = [{ role: 'user', content: [{ type: 'text', text: 'Say hi' }] }];
    const { status, body } = await call(app, { models: MODELS, messages }, true);
    expect(status).toBe(200);
    expect(body.results).toHaveLength(2);
    for (const r of body.results) expect(r).toMatchObject({ ok: true, text: 'array-hi' });
  });

  it('prefers the duplicate row with a routable key', async () => {
    globalThis.fetch = vi.fn(async () => completion('x', 'groq-hi')) as unknown as typeof fetch;
    // A keyless duplicate alias for the same model id must not steal the slot.
    getDb().prepare(`
      INSERT INTO models (platform, model_id, display_name, intelligence_rank, speed_rank, size_label, monthly_token_budget, context_window, supports_vision, supports_tools, enabled)
      SELECT 'dupe', model_id, display_name, intelligence_rank, speed_rank, size_label, monthly_token_budget, context_window, supports_vision, supports_tools, enabled
      FROM models WHERE model_id = 'llama-3.1-8b-instant' LIMIT 1
    `).run();
    const { status, body } = await call(app, { models: MODELS, messages: MESSAGES }, true);
    expect(status).toBe(200);
    const byModel = Object.fromEntries(body.results.map((r: any) => [r.model, r]));
    expect(byModel['llama-3.1-8b-instant']).toMatchObject({ ok: true, platform: 'groq' });
  });

  it('fails only the non-vision model on image content', async () => {
    globalThis.fetch = vi.fn(async () => completion('x', 'seen')) as unknown as typeof fetch;
    getDb().prepare("UPDATE models SET supports_vision = 1 WHERE model_id = 'llama-3.1-8b-instant'").run();
    getDb().prepare("UPDATE models SET supports_vision = 0 WHERE model_id = 'gpt-oss-120b'").run();
    const messages = [{ role: 'user', content: [{ type: 'text', text: 'What is this?' }, { type: 'image_url', image_url: { url: 'http://example.com/a.png' } }] }];
    const { status, body } = await call(app, { models: MODELS, messages }, true);
    expect(status).toBe(200);
    const byModel = Object.fromEntries(body.results.map((r: any) => [r.model, r]));
    expect(byModel['llama-3.1-8b-instant']).toMatchObject({ ok: true, text: 'seen' });
    expect(byModel['gpt-oss-120b']).toMatchObject({ ok: false, error: 'Model does not support image input.' });
  });

  it('fails only the model the request does not fit', async () => {
    globalThis.fetch = vi.fn(async () => completion('x', 'fits')) as unknown as typeof fetch;
    getDb().prepare("UPDATE models SET context_window = 1, tpm_limit = 1 WHERE model_id = 'gpt-oss-120b'").run();
    const { status, body } = await call(app, { models: MODELS, messages: MESSAGES }, true);
    expect(status).toBe(200);
    const byModel = Object.fromEntries(body.results.map((r: any) => [r.model, r]));
    expect(byModel['llama-3.1-8b-instant']).toMatchObject({ ok: true });
    expect(byModel['gpt-oss-120b'].ok).toBe(false);
    expect(byModel['gpt-oss-120b'].error).toContain('context window');
  });

  it('isolates a runner throw to the one model', async () => {
    globalThis.fetch = vi.fn(async () => completion('x', 'fine')) as unknown as typeof fetch;
    vi.mocked(runModelCall).mockRejectedValueOnce(new Error('boom'));
    const { status, body } = await call(app, { models: MODELS, messages: MESSAGES }, true);
    expect(status).toBe(200);
    const byModel = Object.fromEntries(body.results.map((r: any) => [r.model, r]));
    expect(byModel['llama-3.1-8b-instant']).toMatchObject({ ok: false, error: 'boom' });
    expect(byModel['gpt-oss-120b']).toMatchObject({ ok: true, text: 'fine' });
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
      expect(typeof r.displayName).toBe('string');
      expect(r.displayName.length).toBeGreaterThan(0);
    }
  });

  it('isolates failures: one 429 does not cancel the other model', async () => {
    globalThis.fetch = vi.fn(async (url: any) => {
      if (String(url).includes('groq')) {
        return new Response(JSON.stringify({ error: { message: 'Rate limit' } }), { status: 429, headers: { 'content-type': 'application/json' } });
      }
      return completion('gpt-oss-120b', 'cerebras-hi');
    }) as unknown as typeof fetch;
    // Monotonic clock: every result must carry measured, nonzero latency —
    // an always-0 latencyMs would pass a >= 0 assertion unnoticed.
    let now = 1_700_000_000_000;
    const dateSpy = vi.spyOn(Date, 'now').mockImplementation(() => (now += 25));
    try {
      const { status, body } = await call(app, { models: MODELS, messages: MESSAGES }, true);
      expect(status).toBe(200);
      const byModel = Object.fromEntries(body.results.map((r: any) => [r.model, r]));
      expect(byModel['llama-3.1-8b-instant'].ok).toBe(false);
      expect(byModel['llama-3.1-8b-instant'].error).toContain('Rate limit');
      expect(byModel['gpt-oss-120b']).toMatchObject({ ok: true, text: 'cerebras-hi' });
      for (const r of body.results) expect(r.latencyMs).toBeGreaterThan(0);
    } finally {
      dateSpy.mockRestore();
    }
  });
});
