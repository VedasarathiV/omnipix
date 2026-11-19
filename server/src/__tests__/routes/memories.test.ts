import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb } from '../../db/index.js';
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

describe('memories', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    app = createApp();
    dashToken = mintDashboardToken();
  });

  afterEach(() => {
    globalThis.fetch = nativeFetch;
    vi.unstubAllGlobals();
  });

  it('requires dashboard auth', async () => {
    expect((await call('GET', '/api/memories', undefined, false)).status).toBe(401);
  });

  it('creates, lists, updates, and deletes memories', async () => {
    const created = await call('POST', '/api/memories', {
      key: 'commit-style', value: 'conventional commits', importance: 0.9,
    });
    expect(created.status).toBe(201);
    expect(created.body.memory).toMatchObject({ key: 'commit-style', score: expect.any(Number) });

    const pii = await call('POST', '/api/memories', { key: 'c', value: 'call 415-555-0132' });
    expect(pii.body.redactions).toBe(1);
    expect(pii.body.memory.value).not.toContain('415-555-0132');

    expect((await call('POST', '/api/memories', { key: 'x', value: 'y', scope: 'project' })).status).toBe(400);
    const listed = await call('GET', '/api/memories?scope=user');
    expect(listed.body.memories).toHaveLength(2);
    expect((await call('GET', '/api/memories?scope=bogus')).status).toBe(400);

    const id = created.body.memory.id;
    const updated = await call('PATCH', `/api/memories/${id}`, { importance: 0.1 });
    expect(updated.status).toBe(200);
    expect(updated.body.memory.importance).toBe(0.1);
    expect((await call('PATCH', `/api/memories/${id}`, {})).status).toBe(400);
    expect((await call('PATCH', '/api/memories/99999', { importance: 0.5 })).status).toBe(404);

    expect((await call('DELETE', `/api/memories/${id}`)).status).toBe(200);
    expect((await call('DELETE', `/api/memories/${id}`)).status).toBe(404);
  });

  it('ingests a URL into project docs and searches them', async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      '<html><head><title>Guide</title></head><body><h1>Auth</h1><p>Use bearer tokens.</p></body></html>',
      { status: 200, headers: { 'content-type': 'text/html' } },
    )) as unknown as typeof fetch;

    const created = await call('POST', '/api/memories/ingest', { url: 'https://docs.test/guide', project: 'acme' });
    expect(created.status).toBe(201);
    expect(created.body.doc).toMatchObject({ title: 'Guide', chunks: 1 });

    const docs = await call('GET', '/api/memories/docs?project=acme');
    expect(docs.body.docs).toHaveLength(1);
    expect(docs.body.docs[0]).toMatchObject({ source_url: 'https://docs.test/guide', chunks: 1 });
    expect((await call('GET', '/api/memories/docs?project=other')).body.docs).toHaveLength(0);

    const found = await call('GET', '/api/memories/docs/search?project=acme&q=bearer tokens');
    expect(found.body.chunks).toHaveLength(1);
    expect(found.body.chunks[0]).toMatchObject({ section: 'Auth' });
    expect((await call('GET', '/api/memories/docs/search?project=acme&q=missing words here')).body.chunks).toHaveLength(0);

    const deleted = await call('DELETE', '/api/memories/docs?project=acme&url=https://docs.test/guide');
    expect(deleted.status).toBe(200);
    expect(deleted.body.chunks).toBe(1);
    expect((await call('DELETE', '/api/memories/docs?project=acme&url=https://docs.test/guide')).status).toBe(404);
  });

  it('validates docs endpoints', async () => {
    expect((await call('POST', '/api/memories/ingest', { url: 'http://127.0.0.1/x', project: 'acme' })).status).toBe(400);
    expect((await call('POST', '/api/memories/ingest', { url: 'https://x.test' })).status).toBe(400);
    expect((await call('GET', '/api/memories/docs/search?project=acme')).status).toBe(400);
    expect((await call('DELETE', '/api/memories/docs?project=acme')).status).toBe(400);
    expect((await call('GET', '/api/memories/docs', undefined, false)).status).toBe(401);
    expect((await call('POST', '/api/memories/ingest', { url: 'https://x.test', project: 'p' }, false)).status).toBe(401);
  });
});
