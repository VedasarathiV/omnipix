import { getDb } from '../db/index.js';
import { isBlockedFetchUrl } from '../lib/fetch-guard.js';

// Docs ingest (gap 8): fetch a URL, chunk it structurally, and store the
// chunks scoped to a project key. Retrieval is keyword-first (AND over query
// words, occurrence-ranked) — no embeddings, no external index, everything
// local. Agents recall via the recall_docs tool; chat @-mentions pin a doc
// into the prompt.

export const INGEST_TIMEOUT_MS = 30_000;
export const INGEST_MAX_BYTES = 2 * 1024 * 1024;
export const CHUNK_TARGET_CHARS = 800;
export const CHUNK_OVERLAP_CHARS = 100;
export const INGEST_MAX_CHUNKS = 200;
export const SEARCH_DEFAULT_LIMIT = 5;
export const SEARCH_MAX_LIMIT = 10;

export interface DocChunk {
  id: number;
  project_key: string;
  source_url: string;
  title: string;
  chunk_index: number;
  section: string;
  content: string;
}

export interface IngestedDoc {
  project_key: string;
  source_url: string;
  title: string;
  chunks: number;
  updated_at: string;
}

export interface TextChunk {
  section: string;
  content: string;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_m, code: string) => {
      const point = Number(code);
      return Number.isSafeInteger(point) && point > 0 && point < 0x10ffff ? String.fromCodePoint(point) : '';
    });
}

/**
 * HTML to structured plain text. Block elements become line breaks so the
 * chunker sees paragraphs and headers; scripts, styles, and nav/footer
 * boilerplate are dropped. Exported for unit tests.
 */
export function extractStructuredText(html: string): { title: string; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? decodeEntities(titleMatch[1]).replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  let text = html
    .replace(/<title[^>]*>[\s\S]*?<\/title>/gi, '\n')
    .replace(/<script[\s\S]*?<\/script>/gi, '\n')
    .replace(/<style[\s\S]*?<\/style>/gi, '\n')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '\n')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '\n')
    // Headers become markdown so the chunker sees section boundaries.
    .replace(/<h([1-6])[^>]*>/gi, (_m, level: string) => `\n${'#'.repeat(Number(level))} `)
    .replace(/<(p|div|section|article|li|tr|br|blockquote|pre)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  text = decodeEntities(text);
  const lines = text.split('\n').map(line => line.replace(/[ \t]+/g, ' ').trim()).filter(Boolean);
  return { title, text: lines.join('\n') };
}

/**
 * Structural chunker: markdown `#` headers (and ALL-CAPS short lines, the
 * plain-text equivalent) start new sections; paragraphs pack greedily to
 * ~CHUNK_TARGET_CHARS. A new header always starts a new chunk, and a full
 * chunk carries a word-boundary overlap tail into the next one.
 */
export function chunkText(text: string): TextChunk[] {
  const paras: Array<{ section: string; text: string }> = [];
  let section = '';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const md = /^(#{1,6})\s+(.+)$/.exec(line);
    if (md) {
      section = md[2].trim().slice(0, 120);
      continue;
    }
    if (/^[A-Z][A-Z0-9 ,:;'"()/-]{3,80}$/.test(line) && line === line.toUpperCase() && !/[.!?]$/.test(line)) {
      section = line.slice(0, 120);
      continue;
    }
    paras.push({ section: section || '', text: line });
  }
  const chunks: TextChunk[] = [];
  let current: string[] = [];
  let currentLen = 0;
  let currentSection = '';
  const flush = (): void => {
    if (!current.length) return;
    chunks.push({ section: currentSection, content: current.join('\n') });
    current = [];
    currentLen = 0;
  };
  for (const para of paras) {
    // A new header always starts a new chunk (structural boundary, no
    // overlap carried across it); otherwise pack greedily to the target.
    if (para.section !== currentSection) {
      if (current.length) flush();
      currentSection = para.section;
    }
    if (currentLen + para.text.length > CHUNK_TARGET_CHARS && current.length) {
      flush();
      // Overlap: carry the tail of the finished chunk forward so a fact
      // straddling the boundary stays retrievable from either side.
      const prev = chunks[chunks.length - 1].content;
      // Only carry when the finished chunk exceeds the overlap window —
      // otherwise a tiny chunk would duplicate itself wholesale.
      if (prev.length > CHUNK_OVERLAP_CHARS) {
        const tail = prev.slice(-CHUNK_OVERLAP_CHARS);
        const cut = tail.search(/\s/);
        const carry = (cut >= 0 ? tail.slice(cut + 1) : tail).trim();
        if (carry) {
          current = [carry];
          currentLen = carry.length;
        }
      }
    }
    // A single giant paragraph is split hard rather than overflowing the cap.
    if (para.text.length > CHUNK_TARGET_CHARS && !current.length) {
      for (let i = 0; i < para.text.length; i += CHUNK_TARGET_CHARS) {
        chunks.push({ section: currentSection, content: para.text.slice(i, i + CHUNK_TARGET_CHARS) });
      }
      continue;
    }
    current.push(para.text);
    currentLen += para.text.length + 1;
  }
  flush();
  return chunks;
}

async function fetchCapped(url: string, signal?: AbortSignal): Promise<{ text: string; contentType: string; finalUrl: string }> {
  const blocked = isBlockedFetchUrl(url);
  if (blocked) throw new Error(blocked);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INGEST_TIMEOUT_MS);
  const onAbort = (): void => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'omnipix-ingest/1.0', accept: 'text/html,text/plain,application/json,*/*' },
    });
    const finalUrl = res.url || url;
    const finalBlocked = isBlockedFetchUrl(finalUrl);
    if (finalBlocked) throw new Error(`redirect target blocked: ${finalBlocked}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = res.headers.get('content-type') ?? '';
    if (!/text\/|json|xml/i.test(contentType)) {
      throw new Error(`refusing non-text content (${contentType || 'unknown'})`);
    }
    if (!res.body) throw new Error('empty response body');
    const reader = res.body.getReader();
    const parts: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > INGEST_MAX_BYTES) {
        reader.cancel().catch(() => undefined);
        throw new Error(`page exceeds the ${INGEST_MAX_BYTES}-byte ingest cap`);
      }
      parts.push(value);
    }
    const merged = new Uint8Array(bytes);
    let offset = 0;
    for (const part of parts) {
      merged.set(part, offset);
      offset += part.byteLength;
    }
    return { text: new TextDecoder('utf-8').decode(merged), contentType, finalUrl };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export interface IngestResult {
  project_key: string;
  source_url: string;
  title: string;
  chunks: number;
  replaced: boolean;
}

/** Fetch, chunk, and store a URL's text under a project key. Replaces prior chunks for the URL. */
export async function ingestUrl(url: string, projectKey: string, signal?: AbortSignal): Promise<IngestResult> {
  const trimmed = url.trim();
  if (!trimmed || trimmed.length > 2000) throw new Error('url must be 1..2000 characters');
  const project = projectKey.trim();
  if (!project || project.length > 128) throw new Error('project must be 1..128 characters');
  const { text, contentType } = await fetchCapped(trimmed, signal);
  const { title, text: structured } = /html/i.test(contentType)
    ? extractStructuredText(text)
    : { title: '', text: text.split('\n').map(l => l.trim()).filter(Boolean).join('\n') };
  if (!structured.trim()) throw new Error('no text extracted from the page');
  const chunks = chunkText(structured).slice(0, INGEST_MAX_CHUNKS);
  if (!chunks.length) throw new Error('no text extracted from the page');
  const db = getDb();
  const prior = db.prepare('SELECT 1 FROM doc_chunks WHERE project_key = ? AND source_url = ? LIMIT 1')
    .get(project, trimmed) !== undefined;
  const replace = db.transaction(() => {
    db.prepare('DELETE FROM doc_chunks WHERE project_key = ? AND source_url = ?').run(project, trimmed);
    const insert = db.prepare(
      'INSERT INTO doc_chunks (project_key, source_url, title, chunk_index, section, content) VALUES (?, ?, ?, ?, ?, ?)',
    );
    chunks.forEach((chunk, index) => {
      insert.run(project, trimmed, title, index, chunk.section, chunk.content);
    });
  });
  replace();
  return { project_key: project, source_url: trimmed, title, chunks: chunks.length, replaced: prior };
}

export function listDocs(projectKey?: string): IngestedDoc[] {
  const db = getDb();
  const rows = (projectKey?.trim()
    ? db.prepare(
      `SELECT project_key, source_url, MAX(title) AS title, COUNT(*) AS chunks, MAX(created_at) AS updated_at
       FROM doc_chunks WHERE project_key = ? GROUP BY project_key, source_url ORDER BY source_url`,
    ).all(projectKey.trim())
    : db.prepare(
      `SELECT project_key, source_url, MAX(title) AS title, COUNT(*) AS chunks, MAX(created_at) AS updated_at
       FROM doc_chunks GROUP BY project_key, source_url ORDER BY project_key, source_url`,
    ).all()) as IngestedDoc[];
  return rows;
}

export function deleteDoc(projectKey: string, url: string): number {
  const info = getDb().prepare('DELETE FROM doc_chunks WHERE project_key = ? AND source_url = ?')
    .run(projectKey.trim(), url.trim());
  return Number(info.changes);
}

function queryWords(query: string): string[] {
  return query.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 2);
}

/**
 * Keyword retrieval over one project's chunks (optionally one doc): every
 * query word must appear (section counts), ranked by total occurrences then
 * document order. AND semantics keep precision high on small corpora.
 */
export function searchDocs(projectKey: string, query: string, limit = SEARCH_DEFAULT_LIMIT, sourceUrl?: string): DocChunk[] {
  const words = queryWords(query);
  if (!words.length) return [];
  const capped = Math.min(SEARCH_MAX_LIMIT, Math.max(1, limit));
  const db = getDb();
  const rows = (sourceUrl?.trim()
    ? db.prepare('SELECT * FROM doc_chunks WHERE project_key = ? AND source_url = ? ORDER BY chunk_index').all(projectKey.trim(), sourceUrl.trim())
    : db.prepare('SELECT * FROM doc_chunks WHERE project_key = ? ORDER BY source_url, chunk_index').all(projectKey.trim())) as DocChunk[];
  const scored: Array<{ chunk: DocChunk; hits: number }> = [];
  for (const chunk of rows) {
    const haystack = `${chunk.section}\n${chunk.content}`.toLowerCase();
    let hits = 0;
    let all = true;
    for (const word of words) {
      let count = 0;
      let from = 0;
      for (;;) {
        const at = haystack.indexOf(word, from);
        if (at === -1) break;
        count++;
        from = at + word.length;
      }
      if (!count) {
        all = false;
        break;
      }
      hits += count;
    }
    if (all) scored.push({ chunk, hits });
  }
  scored.sort((a, b) => b.hits - a.hits || a.chunk.chunk_index - b.chunk.chunk_index);
  return scored.slice(0, capped).map(s => s.chunk);
}

/** Render recalled chunks as a prompt section. Empty when none. */
export function docsPromptSection(chunks: DocChunk[]): string {
  if (!chunks.length) return '';
  const blocks = chunks.map(c => {
    const head = c.section ? `${c.title || c.source_url} — ${c.section}` : (c.title || c.source_url);
    return `### ${head}\n${c.content}`;
  });
  return `\n\nRelevant docs (quote rather than paraphrase when precision matters):\n${blocks.join('\n\n')}`;
}
