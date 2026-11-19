import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from './index.js';

const token = 'dashboard-session==';
let output: string;

const GUARD = {
  inbound: 'block', outbound: 'redact', blockedPatterns: ['aaa'],
  stats: { inboundRedactions: 1, inboundBlocks: 2, outboundRedactions: 3 },
};

beforeEach(() => {
  output = '';
  vi.stubEnv('OMNIPIX_DASHBOARD_TOKEN', token);
  vi.stubEnv('OMNIPIX_URL', 'http://127.0.0.1:9');
  vi.spyOn(process.stdout, 'write').mockImplementation(chunk => { output += String(chunk); return true; });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function stubFetch(handler: (path: string, init: RequestInit) => Response) {
  vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit = {}) => {
    const path = new URL(input).pathname;
    if (init.headers && (init.headers as Record<string, string>).Authorization !== `Bearer ${token}`) {
      return new Response('no', { status: 401 });
    }
    return handler(path, init);
  }));
}

describe('guard', () => {
  it('shows status', async () => {
    stubFetch(path => {
      if (path === '/api/settings/content-guard') return Response.json(GUARD);
      throw new Error(`Unexpected request: ${path}`);
    });
    expect(await main(['guard', 'status'])).toBe(0);
    expect(output).toContain('inbound: block');
    expect(output).toContain('patterns: aaa');
    expect(output).toContain('2 blocked');
  });

  it('sets knobs and prints the result', async () => {
    let seenBody = '';
    stubFetch((path, init) => {
      if (path === '/api/settings/content-guard' && init.method === 'PUT') {
        seenBody = String(init.body);
        return Response.json({ ...GUARD, inbound: 'redact' });
      }
      throw new Error(`Unexpected request: ${path} ${init.method}`);
    });
    expect(await main(['guard', 'set', '--inbound', 'redact', '--patterns', 'x, y'])).toBe(0);
    expect(JSON.parse(seenBody)).toEqual({ inbound: 'redact', blockedPatterns: ['x', 'y'] });
    expect(output).toContain('inbound: redact');
  });

  it('rejects bad invocations without a request', async () => {
    const fetchSpy = vi.fn(async () => Response.json({}));
    vi.stubGlobal('fetch', fetchSpy);
    await expect(main(['guard', 'set', '--inbound', 'nuke'])).rejects.toThrow('--inbound must be');
    await expect(main(['guard', 'frobnicate'])).rejects.toThrow('guard status or set');
    await expect(main(['guard', 'status', '--threshold', '0.5'])).rejects.toThrow('--threshold is not supported by guard');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('cache', () => {
  it('shows stats, sets the threshold, and flushes', async () => {
    stubFetch((path, init) => {
      if (path === '/api/cache/stats') {
        return Response.json({ enabled: true, entries: 4, hitRate: 0.5, lookupHits: 5, lookupMisses: 5, semanticHits: 2, semanticThreshold: 0.9, savedTokens: 100 });
      }
      if (path === '/api/cache/config' && init.method === 'PUT') {
        return Response.json({ enabled: true, semanticThreshold: 0.9 });
      }
      if (path === '/api/cache' && init.method === 'DELETE') return Response.json({ cleared: 4 });
      throw new Error(`Unexpected request: ${path} ${init.method}`);
    });
    expect(await main(['cache', 'stats'])).toBe(0);
    expect(output).toContain('hit rate: 50.0%');
    expect(output).toContain('semantic hits: 2 (threshold 0.9)');
    output = '';
    expect(await main(['cache', 'set', '--threshold', '0.9'])).toBe(0);
    expect(output).toContain('semantic threshold: 0.9');
    output = '';
    expect(await main(['cache', 'flush'])).toBe(0);
    expect(output).toContain('cleared 4 entries');
  });

  it('rejects bad invocations without a request', async () => {
    const fetchSpy = vi.fn(async () => Response.json({}));
    vi.stubGlobal('fetch', fetchSpy);
    await expect(main(['cache', 'set'])).rejects.toThrow('--threshold');
    await expect(main(['cache', 'set', '--threshold', '7'])).rejects.toThrow('--threshold must be');
    await expect(main(['cache', 'stats', '--inbound', 'off'])).rejects.toThrow('--inbound is not supported by cache');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
