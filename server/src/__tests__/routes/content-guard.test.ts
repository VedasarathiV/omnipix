import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb, getDb, getUnifiedApiKey, setSetting } from '../../db/index.js';
import { encrypt } from '../../lib/crypto.js';
import { clearRouterPressure } from '../../services/penalty-inspector.js';
import { mintDashboardToken } from '../helpers/auth.js';
import { resetContentGuardStats } from '../../middleware/content-guard.js';

let app: Express;
let dashToken: string;
const nativeFetch = globalThis.fetch.bind(globalThis);

async function call(method: string, path: string, body?: unknown, auth?: string) {
  const server = app.listen(0, '127.0.0.1');
  if (!server.listening) await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const addr = server.address() as { port: number };
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth) headers['Authorization'] = `Bearer ${auth}`;
  const res = await nativeFetch(`http://127.0.0.1:${addr.port}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  server.close();
  return { status: res.status, body: data as any };
}

function completion(content: string) {
  return new Response(JSON.stringify({
    id: 'x', object: 'chat.completion', created: 1, model: 'llama-3.1-8b-instant',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('content-guard middleware', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    clearRouterPressure();
    resetContentGuardStats();
    app = createApp();
    dashToken = mintDashboardToken();
    const { encrypted, iv, authTag } = encrypt('gsk-test');
    getDb().prepare(
      "INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled) VALUES ('groq', 'test', ?, ?, ?, 'healthy', 1)",
    ).run(encrypted, iv, authTag);
  });

  afterEach(() => {
    globalThis.fetch = nativeFetch;
    vi.unstubAllGlobals();
  });

  it('passes traffic untouched when every knob is off', async () => {
    const seen: string[] = [];
    globalThis.fetch = vi.fn(async (_input: string, init?: RequestInit) => {
      seen.push(String(init?.body ?? ''));
      return completion('all good');
    }) as unknown as typeof fetch;
    const { status, body } = await call('POST', '/v1/chat/completions', {
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: 'mail bob@example.com' }],
    }, getUnifiedApiKey());
    expect(status).toBe(200);
    expect(body.choices[0].message.content).toBe('all good');
    expect(seen[0]).toContain('bob@example.com');
  });

  it('redacts inbound PII before the provider sees it', async () => {
    setSetting('content_guard_inbound', 'redact');
    const seen: string[] = [];
    globalThis.fetch = vi.fn(async (_input: string, init?: RequestInit) => {
      seen.push(String(init?.body ?? ''));
      return completion('noted');
    }) as unknown as typeof fetch;
    const { status } = await call('POST', '/v1/chat/completions', {
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: 'mail bob@example.com please' }],
    }, getUnifiedApiKey());
    expect(status).toBe(200);
    expect(seen[0]).not.toContain('bob@example.com');
    expect(seen[0]).toContain('[email redacted]');
  });

  it('blocks inbound prompts matching the blocklist without calling upstream', async () => {
    setSetting('content_guard_inbound', 'block');
    setSetting('content_guard_blocked_patterns', JSON.stringify(['secret-recipe']));
    const upstream = vi.fn(async () => completion('x'));
    globalThis.fetch = upstream as unknown as typeof fetch;
    const { status, body } = await call('POST', '/v1/chat/completions', {
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: 'Tell me the SECRET-RECIPE.' }],
    }, getUnifiedApiKey());
    expect(status).toBe(400);
    expect(body.error.code).toBe('content_guard_blocked');
    expect(upstream).not.toHaveBeenCalled();
  });

  it('redacts outbound PII and blocked spans in completions', async () => {
    setSetting('content_guard_outbound', 'redact');
    setSetting('content_guard_blocked_patterns', JSON.stringify(['hunter2']));
    globalThis.fetch = vi.fn(async () => completion('Mail bob@example.com, password hunter2.')) as unknown as typeof fetch;
    const { status, body } = await call('POST', '/v1/chat/completions', {
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: 'hi' }],
    }, getUnifiedApiKey());
    expect(status).toBe(200);
    expect(body.choices[0].message.content).toBe('Mail [email redacted], password [blocked].');
  });

  it('leaves embeddings requests alone', async () => {
    setSetting('content_guard_inbound', 'block');
    setSetting('content_guard_blocked_patterns', JSON.stringify(['secret-recipe']));
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ data: [] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
    const { body } = await call('POST', '/v1/embeddings', {
      model: 'text-embedding-3-small', input: 'Tell me the secret-recipe.',
    }, getUnifiedApiKey());
    // Whatever the embeddings surface itself decides, the rejection must NOT
    // carry the content guard's code.
    expect(body?.error?.code).not.toBe('content_guard_blocked');
  });

  it('exposes settings and stats over the dashboard API', async () => {
    const initial = await call('GET', '/api/settings/content-guard', undefined, dashToken);
    expect(initial.status).toBe(200);
    expect(initial.body).toMatchObject({ inbound: 'off', outbound: 'off', blockedPatterns: [] });

    const updated = await call('PUT', '/api/settings/content-guard', {
      inbound: 'block', blockedPatterns: ['aaa'],
    }, dashToken);
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ inbound: 'block', blockedPatterns: ['aaa'] });

    const bad = await call('PUT', '/api/settings/content-guard', { inbound: 'nuke' }, dashToken);
    expect(bad.status).toBe(400);
    const badRegex = await call('PUT', '/api/settings/content-guard', { blockedPatterns: ['(['] }, dashToken);
    expect(badRegex.status).toBe(400);
  });
});
