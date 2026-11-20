import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initDb, getDb } from '../../db/index.js';
import { setGuardedFetchResolve } from '../../lib/guarded-fetch.js';
import {
  chunkText,
  deleteDoc,
  docsPromptSection,
  extractStructuredText,
  ingestUrl,
  listDocs,
  searchDocs,
} from '../../services/docs-ingest.js';

const nativeFetch = globalThis.fetch.bind(globalThis);

const PAGE = `
<html><head><title>Widget API Guide</title>
<script>console.log("drop me");</script>
<style>.x { color: red; }</style>
</head><body>
<nav>Home | Docs | Pricing</nav>
<h1>Getting Started</h1>
<p>Install the widget SDK with npm install widget-sdk. You need Node 20 or newer.</p>
<h2>Authentication</h2>
<p>Pass your API key in the Authorization header as a Bearer token. Keys start with wk_live_ and never expire unless rotated.</p>
<h2>Rate Limits</h2>
<p>The Widget API allows 100 requests per minute per key. Exceeding the limit returns HTTP 429 with a Retry-After header.</p>
<footer>Copyright 2026 Widget Inc.</footer>
</body></html>
`;

function seedChunks(): void {
  const db = getDb();
  const insert = db.prepare(
    'INSERT INTO doc_chunks (project_key, source_url, title, chunk_index, section, content) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const { text } = extractStructuredText(PAGE);
  chunkText(text).forEach((chunk, index) => {
    insert.run('acme', 'https://docs.widget.test/guide', 'Widget API Guide', index, chunk.section, chunk.content);
  });
  insert.run('other', 'https://docs.widget.test/guide', 'Widget API Guide', 0, '', 'Unrelated project content about gardening.');
}

describe('docs ingest', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    // No real DNS in tests: fake hosts resolve to a public documentation IP.
    setGuardedFetchResolve(async () => ['93.184.216.34']);
  });

  afterEach(() => {
    globalThis.fetch = nativeFetch;
    setGuardedFetchResolve(null);
    vi.unstubAllGlobals();
  });

  it('extracts structured text without boilerplate', () => {
    const { title, text } = extractStructuredText(PAGE);
    expect(title).toBe('Widget API Guide');
    expect(text).toContain('Getting Started');
    expect(text).toContain('wk_live_');
    expect(text).not.toContain('drop me');
    expect(text).not.toContain('color: red');
    expect(text).not.toContain('Home | Docs');
    expect(text).not.toContain('Copyright');
    expect(text).not.toMatch(/<[^>]+>/);
  });

  it('chunks structurally with section tracking', () => {
    const { text } = extractStructuredText(PAGE);
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    const auth = chunks.find(c => c.section === 'Authentication');
    expect(auth?.content).toContain('Bearer token');
    const limits = chunks.find(c => c.section === 'Rate Limits');
    expect(limits?.content).toContain('429');
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(800);
    }
  });

  it('retrieves the right chunk first (golden set)', () => {
    seedChunks();
    // Each query must rank its answer chunk first — the retrieval contract.
    const golden: Array<[string, string]> = [
      ['bearer token authorization', 'Bearer token'],
      ['rate limit 429 retry', '429'],
      ['npm install node 20', 'widget-sdk'],
      ['api key expire rotated', 'wk_live_'],
    ];
    for (const [query, needle] of golden) {
      const hits = searchDocs('acme', query);
      expect(hits.length, `query: ${query}`).toBeGreaterThan(0);
      expect(hits[0].content, `query: ${query}`).toContain(needle);
    }
    // AND semantics: no chunk mentions both, so nothing matches.
    expect(searchDocs('acme', 'bearer gardening')).toHaveLength(0);
    // Project scoping: other projects never leak in.
    expect(searchDocs('acme', 'gardening')).toHaveLength(0);
    expect(searchDocs('other', 'gardening')).toHaveLength(1);
    expect(searchDocs('acme', 'x')).toHaveLength(0);
  });

  it('renders recalled chunks as a prompt section', () => {
    seedChunks();
    const section = docsPromptSection(searchDocs('acme', 'bearer token'));
    expect(section).toContain('Relevant docs');
    expect(section).toContain('Authentication');
    expect(docsPromptSection([])).toBe('');
  });

  it('ingests a URL and replaces on re-ingest', async () => {
    globalThis.fetch = vi.fn(async () => new Response(PAGE, {
      status: 200, headers: { 'content-type': 'text/html' },
    })) as unknown as typeof fetch;

    const first = await ingestUrl('https://docs.widget.test/guide', 'acme');
    expect(first).toMatchObject({ title: 'Widget API Guide', replaced: false });
    expect(first.chunks).toBeGreaterThan(0);
    expect(listDocs('acme')).toHaveLength(1);
    expect(searchDocs('acme', 'bearer token')).not.toHaveLength(0);

    const second = await ingestUrl('https://docs.widget.test/guide', 'acme');
    expect(second.replaced).toBe(true);
    expect(listDocs('acme')).toHaveLength(1);

    expect(deleteDoc('acme', 'https://docs.widget.test/guide')).toBeGreaterThan(0);
    expect(listDocs('acme')).toHaveLength(0);
    expect(deleteDoc('acme', 'https://docs.widget.test/guide')).toBe(0);
  });

  it('refuses blocked hosts, non-text, and empty pages', async () => {
    await expect(ingestUrl('http://127.0.0.1/x', 'acme')).rejects.toThrow('loopback');
    await expect(ingestUrl('ftp://x.test/f', 'acme')).rejects.toThrow('http(s)');
    await expect(ingestUrl('https://x.test/f', '')).rejects.toThrow('project');

    globalThis.fetch = vi.fn(async () => new Response('%PDF-1.4', {
      status: 200, headers: { 'content-type': 'application/pdf' },
    })) as unknown as typeof fetch;
    await expect(ingestUrl('https://x.test/f.pdf', 'acme')).rejects.toThrow('non-text');

    globalThis.fetch = vi.fn(async () => new Response('<html><body><script>var x = 1;</script></body></html>', {
      status: 200, headers: { 'content-type': 'text/html' },
    })) as unknown as typeof fetch;
    await expect(ingestUrl('https://x.test/empty', 'acme')).rejects.toThrow('no text');
  });
});
