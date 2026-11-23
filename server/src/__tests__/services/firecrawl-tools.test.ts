import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initDb, getDb } from '../../db/index.js';
import { encrypt } from '../../lib/crypto.js';
import { FIRECRAWL_TOOLS } from '../../services/firecrawl-tools.js';

const ctx = { runId: 1 };

function seedFirecrawlKey() {
  const e = encrypt('fc-test-key');
  getDb().prepare(
    "INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled) VALUES ('firecrawl', 'test', ?, ?, ?, 'healthy', 1)",
  ).run(e.encrypted, e.iv, e.authTag);
}

function byName(name: string) {
  const tool = FIRECRAWL_TOOLS.find(t => t.name === name);
  if (!tool) throw new Error(`missing tool ${name}`);
  return tool;
}

beforeEach(() => {
  process.env.ENCRYPTION_KEY = '0'.repeat(64);
  initDb(':memory:');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  getDb().close();
});

describe('firecrawl tools', () => {
  it('scrape returns markdown and clips long pages', async () => {
    seedFirecrawlKey();
    const markdown = `# Title\n${'x'.repeat(70000)}`;
    const fetchMock = vi.fn(async () => Response.json({ success: true, data: { markdown } }));
    vi.stubGlobal('fetch', fetchMock);
    const out = await byName('firecrawl_scrape').execute({ url: 'https://example.com/docs' }, ctx);
    expect(out).toContain('# Title');
    expect(out).toContain('clipped to 60000 chars');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/scrape');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer fc-test-key');
  });

  it('scrape fails fast with guidance when no key is saved', async () => {
    await expect(byName('firecrawl_scrape').execute({ url: 'https://example.com' }, ctx))
      .rejects.toThrow('No Firecrawl key');
  });

  it('map lists discovered URLs, capped', async () => {
    seedFirecrawlKey();
    const links = Array.from({ length: 250 }, (_, i) => `https://example.com/p${i}`);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true, data: { links } })));
    const out = await byName('firecrawl_map').execute({ url: 'https://example.com' }, ctx);
    expect(out).toContain('250 URLs');
    expect(out).toContain('showing 200');
  });

  it('crawl polls to completion and returns page markdown', async () => {
    seedFirecrawlKey();
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith('/crawl')) return Response.json({ success: true, id: 'job1' });
      return Response.json({
        status: 'completed',
        data: [{ url: 'https://example.com/a', markdown: '# A\nhello' }],
      });
    }));
    const out = await byName('firecrawl_crawl').execute({ url: 'https://example.com', limit: 2 }, ctx);
    expect(out).toContain('Crawled 1 pages');
    expect(out).toContain('# A');
  });

  it('extract returns JSON text', async () => {
    seedFirecrawlKey();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true, data: { price: '$9' } })));
    const out = await byName('firecrawl_extract').execute(
      { urls: ['https://example.com/p'], prompt: 'the price' }, ctx,
    );
    expect(out).toContain('"$9"');
  });

  it('extract validates url count', async () => {
    seedFirecrawlKey();
    await expect(byName('firecrawl_extract').execute({ urls: [], prompt: 'x' }, ctx))
      .rejects.toThrow('1-5 urls');
  });

  it('surfaces upstream HTTP failures', async () => {
    seedFirecrawlKey();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad', { status: 402 })));
    await expect(byName('firecrawl_scrape').execute({ url: 'https://example.com' }, ctx))
      .rejects.toThrow('HTTP 402');
  });
});
