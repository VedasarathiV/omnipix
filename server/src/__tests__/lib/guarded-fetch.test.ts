import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchGuarded,
  isBlockedFetchUrlResolved,
  setGuardedFetchResolve,
  FETCH_GUARD_MAX_REDIRECTS,
} from '../../lib/guarded-fetch.js';

const PUBLIC = async () => ['93.184.216.34'];
const nativeFetch = globalThis.fetch.bind(globalThis);

afterEach(() => {
  globalThis.fetch = nativeFetch;
  setGuardedFetchResolve(null);
  vi.unstubAllGlobals();
});

function redirectTo(location: string) {
  return new Response(null, { status: 302, headers: { location } });
}

describe('DNS-aware fetch guard', () => {
  it('allows public hostnames and blocks private/metadata resolutions', async () => {
    await expect(isBlockedFetchUrlResolved('https://example.com/x', { resolve: PUBLIC })).resolves.toBeNull();
    await expect(isBlockedFetchUrlResolved('https://evil.test/', { resolve: async () => ['10.9.9.9'] }))
      .resolves.toMatch(/private/);
    await expect(isBlockedFetchUrlResolved('https://evil.test/', { resolve: async () => ['169.254.169.254'] }))
      .resolves.toMatch(/metadata/);
    await expect(isBlockedFetchUrlResolved('https://evil.test/', { resolve: async () => ['127.0.0.1'] }))
      .resolves.toMatch(/private|loopback/);
    await expect(isBlockedFetchUrlResolved('https://evil.test/', { resolve: async () => ['fe80::1'] }))
      .resolves.toMatch(/link-local/);
  });

  it('blocks metadata hostnames without resolving', async () => {
    const resolve = vi.fn(async () => ['93.184.216.34']);
    await expect(isBlockedFetchUrlResolved('http://metadata.google.internal/', { resolve }))
      .resolves.toMatch(/metadata/);
  });

  it('fails closed when DNS cannot resolve', async () => {
    await expect(isBlockedFetchUrlResolved('https://nx.test/', { resolve: async () => { throw new Error('NXDOMAIN'); } }))
      .resolves.toMatch(/could not resolve/);
    await expect(isBlockedFetchUrlResolved('https://nx.test/', { resolve: async () => [] }))
      .resolves.toMatch(/could not resolve/);
  });

  it('keeps the sync literal fast path and never resolves literal IPs', async () => {
    const resolve = vi.fn(async () => ['93.184.216.34']);
    await expect(isBlockedFetchUrlResolved('http://127.0.0.1/', { resolve })).resolves.toMatch(/loopback/);
    await expect(isBlockedFetchUrlResolved('http://10.0.0.5/', { resolve })).resolves.toMatch(/private/);
    await expect(isBlockedFetchUrlResolved('ftp://x.test/', { resolve })).resolves.toMatch(/http\(s\)/);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('honors the module-level resolver hook', async () => {
    setGuardedFetchResolve(async () => ['10.0.0.1']);
    await expect(isBlockedFetchUrlResolved('https://anything.test/')).resolves.toMatch(/private/);
  });
});

describe('fetchGuarded redirect loop', () => {
  it('returns non-redirect responses untouched', async () => {
    globalThis.fetch = vi.fn(async () => new Response('hi', { status: 200 })) as unknown as typeof fetch;
    const res = await fetchGuarded('https://a.test/', {}, { resolve: PUBLIC });
    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toBe('hi');
  });

  it('follows relative and absolute redirects, guarding every hop', async () => {
    const seen: string[] = [];
    globalThis.fetch = vi.fn(async (url: unknown) => {
      seen.push(String(url));
      if (String(url) === 'https://a.test/') return redirectTo('/b');
      if (String(url) === 'https://a.test/b') return redirectTo('https://c.test/d');
      return new Response('done', { status: 200 });
    }) as unknown as typeof fetch;
    const res = await fetchGuarded('https://a.test/', {}, { resolve: PUBLIC });
    expect(await res.text()).toBe('done');
    expect(seen).toEqual(['https://a.test/', 'https://a.test/b', 'https://c.test/d']);
  });

  it('blocks a redirect to a private target WITHOUT requesting it', async () => {
    const seen: string[] = [];
    globalThis.fetch = vi.fn(async (url: unknown) => {
      seen.push(String(url));
      return redirectTo('http://192.168.1.1/admin');
    }) as unknown as typeof fetch;
    await expect(fetchGuarded('https://a.test/', {}, { resolve: PUBLIC })).rejects.toThrow('redirect target blocked');
    expect(seen).toEqual(['https://a.test/']);
  });

  it('blocks a redirect to a DNS-rebinding hostname', async () => {
    globalThis.fetch = vi.fn(async () => redirectTo('https://evil.test/')) as unknown as typeof fetch;
    const resolve = async (host: string) => (host === 'evil.test' ? ['169.254.169.254'] : ['93.184.216.34']);
    await expect(fetchGuarded('https://a.test/', {}, { resolve })).rejects.toThrow('redirect target blocked');
  });

  it('refuses redirect loops and invalid locations', async () => {
    globalThis.fetch = vi.fn(async () => redirectTo('https://a.test/loop')) as unknown as typeof fetch;
    await expect(fetchGuarded('https://a.test/', {}, { resolve: PUBLIC }))
      .rejects.toThrow(`over ${FETCH_GUARD_MAX_REDIRECTS}`);
    globalThis.fetch = vi.fn(async () => redirectTo('http://[::1')) as unknown as typeof fetch;
    await expect(fetchGuarded('https://a.test/', {}, { resolve: PUBLIC })).rejects.toThrow('redirect target blocked');
  });

  it('forwards init (headers/signal) to every hop', async () => {
    const inits: RequestInit[] = [];
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      inits.push(init ?? {});
      return new Response('ok', { status: 200 });
    }) as unknown as typeof fetch;
    const controller = new AbortController();
    await fetchGuarded('https://a.test/', { signal: controller.signal, headers: { 'user-agent': 't' } }, { resolve: PUBLIC });
    expect(inits).toHaveLength(1);
    expect((inits[0].headers as Record<string, string>)['user-agent']).toBe('t');
    expect(inits[0].signal).toBe(controller.signal);
  });
});
