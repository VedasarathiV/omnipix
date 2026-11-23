import { FIRECRAWL_BASE_URL } from '../providers/firecrawl.js';
import { reserveProviderCredential } from './provider-credential.js';
import type { AgentTool } from './agent-tools.js';
import type { ChatToolDefinition } from '@omnipix/shared/types.js';

// Firecrawl Cloud tools for agents: JS-rendered scraping, site mapping,
// bounded crawls, and schema-guided extraction. All four run on the
// operator's own Firecrawl key (Keys page, `firecrawl` platform) — no key,
// no tools: each executor fails fast with guidance instead of a 401.
//
// Kept separate from agent-tools.ts so the provider wiring stays in one
// place; agent-tools.ts pushes FIRECRAWL_TOOLS into AGENT_TOOLS and
// agent-runtime.ts lists the names, like OFFICE_TOOLS.

const FETCH_TIMEOUT_MS = 30_000;
const SCRAPE_MAX_CHARS = 60_000;
const MAP_MAX_LINKS = 200;
const CRAWL_MAX_PAGES = 10;
const CRAWL_POLL_MS = 2_000;
const CRAWL_POLL_ROUNDS = 30;
const EXTRACT_MAX_CHARS = 20_000;

function toolDefinition(name: string, description: string, properties: Record<string, unknown>, required: string[]): ChatToolDefinition {
  return {
    type: 'function',
    function: { name, description, parameters: { type: 'object', properties, required } },
  };
}

function strArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`missing required string argument: ${key}`);
  return value;
}

async function firecrawl(path: string, key: string, body: unknown, signal?: AbortSignal, timeoutMs = FETCH_TIMEOUT_MS): Promise<unknown> {
  const res = await fetch(`${FIRECRAWL_BASE_URL}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]),
  });
  if (!res.ok) {
    const detail = await res.text().then(t => t.slice(0, 300)).catch(() => '');
    throw new Error(`Firecrawl ${path} failed: HTTP ${res.status}${detail ? ` — ${detail}` : ''}`);
  }
  return res.json() as Promise<unknown>;
}

async function withKey<T>(fn: (key: string) => Promise<T>): Promise<T> {
  const { credential } = reserveProviderCredential({ platform: 'firecrawl', key_id: null }, 0);
  if (!credential) {
    throw new Error('No Firecrawl key: add one on the Keys page (firecrawl platform) to use web scraping tools.');
  }
  try {
    return await fn(credential.key);
  } finally {
    credential.release();
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
}

export const FIRECRAWL_TOOLS: AgentTool[] = [
  {
    name: 'firecrawl_scrape',
    definition: toolDefinition(
      'firecrawl_scrape',
      'Scrape ONE page (JS-rendered) into clean markdown. Use for docs/API pages that fetch_url mangles.',
      { url: { type: 'string', description: 'The full http(s) URL to scrape.' } },
      ['url'],
    ),
    execute: async (args, ctx) => withKey(async key => {
      const url = strArg(args, 'url');
      const res = asRecord(await firecrawl('/scrape', key, { url, formats: ['markdown'] }, ctx.signal));
      if (res.success === false) throw new Error(`Firecrawl scrape failed for ${url}`);
      const markdown = asRecord(res.data).markdown;
      if (typeof markdown !== 'string' || !markdown.trim()) throw new Error(`Firecrawl returned no markdown for ${url}`);
      const clipped = markdown.slice(0, SCRAPE_MAX_CHARS);
      return clipped + (markdown.length > SCRAPE_MAX_CHARS ? `\n\n[…clipped to ${SCRAPE_MAX_CHARS} chars]` : '');
    }),
  },
  {
    name: 'firecrawl_map',
    definition: toolDefinition(
      'firecrawl_map',
      'List the URLs on a site (sitemap-style discovery). Fast: use before crawling to pick targets.',
      { url: { type: 'string', description: 'Site root URL, e.g. https://docs.example.com.' } },
      ['url'],
    ),
    execute: async (args, ctx) => withKey(async key => {
      const url = strArg(args, 'url');
      const res = asRecord(await firecrawl('/map', key, { url }, ctx.signal));
      if (res.success === false) throw new Error(`Firecrawl map failed for ${url}`);
      const data = asRecord(res.data);
      const links = Array.isArray(data.links) ? data.links.filter((l): l is string => typeof l === 'string') : [];
      const shown = links.slice(0, MAP_MAX_LINKS);
      return [`${links.length} URLs on ${url}${links.length > MAP_MAX_LINKS ? ` (showing ${MAP_MAX_LINKS})` : ''}:`, ...shown.map(l => `- ${l}`)].join('\n');
    }),
  },
  {
    name: 'firecrawl_crawl',
    definition: toolDefinition(
      'firecrawl_crawl',
      'Crawl a site into markdown pages (bounded: up to 10 pages). Slow (polls up to ~60s); prefer map+scrape for one page.',
      {
        url: { type: 'string', description: 'Site root URL to crawl.' },
        limit: { type: 'number', description: 'Max pages, 1-10 (default 5).' },
      },
      ['url'],
    ),
    execute: async (args, ctx) => withKey(async key => {
      const url = strArg(args, 'url');
      const limit = typeof args.limit === 'number' ? Math.min(CRAWL_MAX_PAGES, Math.max(1, Math.floor(args.limit))) : 5;
      const started = asRecord(await firecrawl('/crawl', key, { url, limit }, ctx.signal));
      const id = typeof started.id === 'string' ? started.id : null;
      if (started.success === false || !id) throw new Error(`Firecrawl crawl failed to start for ${url}`);
      for (let i = 0; i < CRAWL_POLL_ROUNDS; i++) {
        if (ctx.signal?.aborted) throw new Error('crawl aborted');
        await new Promise(r => setTimeout(r, CRAWL_POLL_MS));
        const res = await fetch(`${FIRECRAWL_BASE_URL}/crawl/${id}`, {
          headers: { Authorization: `Bearer ${key}` },
          signal: ctx.signal,
        });
        if (!res.ok) throw new Error(`Firecrawl crawl status failed: HTTP ${res.status}`);
        const body = asRecord(await res.json());
        if (body.status === 'completed') {
          const pages = Array.isArray(body.data) ? body.data : [];
          const out: string[] = [`Crawled ${pages.length} pages from ${url}:`];
          for (const p of pages.slice(0, CRAWL_MAX_PAGES)) {
            const page = asRecord(p);
            const text = typeof page.markdown === 'string' ? page.markdown : '';
            out.push(`\n## ${String(page.url ?? '(unknown url)')}\n${text.slice(0, 6000)}`);
          }
          return out.join('\n');
        }
        if (body.status === 'failed') throw new Error(`Firecrawl crawl failed for ${url}`);
      }
      throw new Error(`Firecrawl crawl timed out for ${url} (job ${id})`);
    }),
  },
  {
    name: 'firecrawl_extract',
    definition: toolDefinition(
      'firecrawl_extract',
      'Extract structured data from pages with an LLM (prices, specs, contacts). Returns JSON text.',
      {
        urls: { type: 'array', description: 'One or more full http(s) URLs.', items: { type: 'string' } },
        prompt: { type: 'string', description: 'What to extract, e.g. "the pricing tiers".' },
      },
      ['urls', 'prompt'],
    ),
    execute: async (args, ctx) => withKey(async key => {
      if (!Array.isArray(args.urls) || args.urls.length === 0 || args.urls.length > 5) {
        throw new Error('firecrawl_extract needs 1-5 urls');
      }
      const prompt = strArg(args, 'prompt');
      const res = asRecord(await firecrawl('/extract', key, { urls: args.urls, prompt }, ctx.signal, 60_000));
      if (res.success === false) throw new Error('Firecrawl extract failed');
      const text = JSON.stringify(res.data ?? res, null, 2);
      return text.length > EXTRACT_MAX_CHARS ? text.slice(0, EXTRACT_MAX_CHARS) + '\n[…clipped]' : text;
    }),
  },
];
