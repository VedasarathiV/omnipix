import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getDb, initDb } from '../../db/index.js';
import { discoverEndpointModels } from '../../services/model-discovery.js';
import {
  connectLocalOllama,
  getOllamaStatus,
  pullOllamaModel,
} from '../../services/local-ollama.js';

vi.mock('../../services/model-discovery.js', async () => {
  const actual = await vi.importActual('../../services/model-discovery.js');
  return { ...actual, discoverEndpointModels: vi.fn() };
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function daemonUp() {
  return vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u.endsWith('/api/version')) return json({ version: '0.40.16' });
    if (u.endsWith('/api/tags')) {
      return json({ models: [{ name: 'qwen2.5-coder:0.5b', size: 397000000 }] });
    }
    throw new Error(`unexpected ${u}`);
  }) as unknown as typeof fetch;
}

describe('local ollama setup', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    vi.mocked(discoverEndpointModels).mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports a running daemon with its models', async () => {
    const status = await getOllamaStatus(daemonUp());
    expect(status).toMatchObject({ running: true, version: '0.40.16', connected: false });
    expect(status.models).toEqual([{ name: 'qwen2.5-coder:0.5b', size: 397000000 }]);
  });

  it('reports a down daemon without throwing', async () => {
    const down = vi.fn(async () => { throw new Error('refused'); }) as unknown as typeof fetch;
    const status = await getOllamaStatus(down);
    expect(status).toMatchObject({ running: false, version: null, models: [], connected: false });
  });

  it('connect registers discovered chat models idempotently', async () => {
    globalThis.fetch = daemonUp() as unknown as typeof fetch;
    try {
      vi.mocked(discoverEndpointModels).mockResolvedValue([
        { id: 'qwen2.5-coder:0.5b', ownedBy: null },
        { id: 'embed-model', ownedBy: null, kind: 'embedding' },
      ]);
      const first = await connectLocalOllama();
      expect(first.models).toEqual(['qwen2.5-coder:0.5b']);
      expect(first.created).toEqual(['qwen2.5-coder:0.5b']);
      const second = await connectLocalOllama();
      expect(second.created).toEqual([]);
      const rows = getDb().prepare("SELECT model_id FROM models WHERE platform = 'custom'").all();
      expect(rows).toHaveLength(1);
      const status = await getOllamaStatus(globalThis.fetch);
      expect(status.connected).toBe(true);
      expect(status.registeredModels).toEqual(['qwen2.5-coder:0.5b']);
    } finally {
      globalThis.fetch = fetch;
    }
  });

  it('connect refuses when the daemon is down or model-less', async () => {
    globalThis.fetch = (vi.fn(async () => { throw new Error('refused'); }) as unknown as typeof fetch);
    try {
      await expect(connectLocalOllama()).rejects.toThrow('not running');
      globalThis.fetch = daemonUp() as unknown as typeof fetch;
      vi.mocked(discoverEndpointModels).mockResolvedValue([]);
      await expect(connectLocalOllama()).rejects.toThrow('no chat models');
    } finally {
      globalThis.fetch = fetch;
    }
  });

  it('pull validates names and posts to the daemon', async () => {
    await expect(pullOllamaModel('  ')).rejects.toThrow('required');
    await expect(pullOllamaModel('bad name!')).rejects.toThrow('Invalid model name');
    const calls: unknown[] = [];
    const fetchFn = (async (url: unknown, init: unknown) => {
      calls.push({ url: String(url), init });
      return json({ status: 'success' });
    }) as unknown as typeof fetch;
    const result = await pullOllamaModel('qwen2.5-coder:7b', fetchFn);
    expect(result.name).toBe('qwen2.5-coder:7b');
    expect(calls).toHaveLength(1);
    const init = (calls[0] as { init: { body: string } }).init;
    expect(JSON.parse(init.body)).toMatchObject({ name: 'qwen2.5-coder:7b', stream: false });
    const rows = getDb().prepare("SELECT model_id FROM models WHERE platform = 'custom'").all() as { model_id: string }[];
    expect(rows.map(r => r.model_id)).toContain('qwen2.5-coder:7b');
  });

  it('pull surfaces a daemon refusal with its reason', async () => {
    const fetchFn = (async () => new Response('model not found', { status: 404 })) as unknown as typeof fetch;
    await expect(pullOllamaModel('nope:nope', fetchFn)).rejects.toThrow('404');
  });
});
