// Gateway-side content guardrails: PII redaction and an operator blocklist,
// applied to chat traffic inside the gateway so they work identically for
// every provider behind it. Everything is OFF by default — an unconfigured
// install behaves exactly as before.
//
// Settings (settings table wins, then env, then default):
//   content_guard_inbound  — off | redact | block
//   content_guard_outbound — off | redact
//   content_guard_blocked_patterns — JSON array of regex strings (max 50, each
//     max 200 chars; entries that fail to compile are ignored, never fatal)
//
// Inbound `block` rejects the request with 400 before any provider is tried.
// Inbound `redact` rewrites PII in the request body in place. Outbound
// `redact` rewrites PII and blocked-pattern spans in non-streaming JSON
// responses. Streaming deltas are NOT scanned — redacting a PII match split
// across two chunks would need reassembly; operators who need outbound
// guarantees on streams should disable streaming clientside.

import { getSetting } from '../db/index.js';

export const CONTENT_GUARD_INBOUND_SETTING = 'content_guard_inbound';
export const CONTENT_GUARD_OUTBOUND_SETTING = 'content_guard_outbound';
export const CONTENT_GUARD_BLOCKED_PATTERNS_SETTING = 'content_guard_blocked_patterns';

export type InboundMode = 'off' | 'redact' | 'block';
export type OutboundMode = 'off' | 'redact';

const MAX_PATTERNS = 50;
const MAX_PATTERN_LENGTH = 200;

function readSetting(key: string, envKey: string): string | undefined {
  let stored: string | undefined;
  try {
    stored = getSetting(key);
  } catch {
    stored = undefined; // DB not ready — never throw on the proxy hot path
  }
  for (const raw of [stored, process.env[envKey]]) {
    if (raw === undefined || raw.trim() === '') continue;
    return raw;
  }
  return undefined;
}

export function getInboundGuardMode(): InboundMode {
  const raw = readSetting(CONTENT_GUARD_INBOUND_SETTING, 'CONTENT_GUARD_INBOUND');
  return raw === 'redact' || raw === 'block' ? raw : 'off';
}

export function getOutboundGuardMode(): OutboundMode {
  return readSetting(CONTENT_GUARD_OUTBOUND_SETTING, 'CONTENT_GUARD_OUTBOUND') === 'redact'
    ? 'redact'
    : 'off';
}

/** Compile the operator blocklist. Bad entries are skipped, never fatal. */
export function getBlockedPatterns(): RegExp[] {
  const raw = readSetting(CONTENT_GUARD_BLOCKED_PATTERNS_SETTING, 'CONTENT_GUARD_BLOCKED_PATTERNS');
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: RegExp[] = [];
  for (const entry of parsed.slice(0, MAX_PATTERNS)) {
    if (typeof entry !== 'string' || entry.length === 0 || entry.length > MAX_PATTERN_LENGTH) continue;
    try {
      out.push(new RegExp(entry, 'gi'));
    } catch {
      // Invalid regex from the operator — skip it rather than breaking traffic.
    }
  }
  return out;
}

export function getBlockedPatternSources(): string[] {
  const raw = readSetting(CONTENT_GUARD_BLOCKED_PATTERNS_SETTING, 'CONTENT_GUARD_BLOCKED_PATTERNS');
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is string => typeof entry === 'string')
      .slice(0, MAX_PATTERNS);
  } catch {
    return [];
  }
}

// ── PII ──────────────────────────────────────────────────────────────────────

const PII_REPLACEMENTS: Array<{ name: string; pattern: RegExp; replacement: string }> = [
  { name: 'email', pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, replacement: '[email redacted]' },
  { name: 'phone', pattern: /(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]?\d{3}[-.\s]?\d{4}/g, replacement: '[phone redacted]' },
  { name: 'ssn', pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[ssn redacted]' },
  { name: 'card', pattern: /\b(?:\d{4}[- ]?){3}\d{4}\b/g, replacement: '[card redacted]' },
];

export function redactPii(text: string): { text: string; redactions: number } {
  let redactions = 0;
  let out = text;
  for (const { pattern, replacement } of PII_REPLACEMENTS) {
    pattern.lastIndex = 0;
    out = out.replace(pattern, () => {
      redactions += 1;
      return replacement;
    });
  }
  return { text: out, redactions };
}

/** First blocked-pattern match in the text, if any. Returns the match index. */
export function findBlockedMatch(text: string, patterns: readonly RegExp[]): number {
  for (let i = 0; i < patterns.length; i++) {
    patterns[i].lastIndex = 0;
    if (patterns[i].test(text)) return i;
  }
  return -1;
}

export function redactBlockedSpans(text: string, patterns: readonly RegExp[]): { text: string; redactions: number } {
  let redactions = 0;
  let out = text;
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    out = out.replace(pattern, () => {
      redactions += 1;
      return '[blocked]';
    });
  }
  return { text: out, redactions };
}

// ── Body walkers ─────────────────────────────────────────────────────────────
// The middleware rewrites request/response bodies in place through these
// walkers, which cover the shapes each protocol surface actually sends:
// OpenAI chat (messages[].content as string or text blocks), Anthropic
// (system + messages), Responses (input), Ollama (prompt/messages), and the
// matching completion envelopes outbound.

type TextVisitor = (text: string) => string;

function mapTextBlock(block: unknown, visit: TextVisitor): void {
  if (typeof block === 'string') return; // replaced by the caller, not here
  if (!block || typeof block !== 'object') return;
  const record = block as Record<string, unknown>;
  if (typeof record.text === 'string') record.text = visit(record.text);
  // Responses input_text / output_text blocks nest the string one deeper.
  if (typeof record.content === 'string' && (record.type === 'input_text' || record.type === 'output_text')) {
    record.content = visit(record.content);
  }
}

function mapMessageContent(message: Record<string, unknown>, visit: TextVisitor): void {
  const content = message.content;
  if (typeof content === 'string') {
    message.content = visit(content);
    return;
  }
  if (Array.isArray(content)) {
    for (let i = 0; i < content.length; i++) {
      if (typeof content[i] === 'string') content[i] = visit(content[i] as string);
      else mapTextBlock(content[i], visit);
    }
  }
}

/** Rewrite every inbound prompt string in a chat request body. Returns the
 *  number of strings visited (for observability, not for branching). */
export function mapInboundText(body: unknown, visit: TextVisitor): number {
  if (!body || typeof body !== 'object') return 0;
  const record = body as Record<string, unknown>;
  let visited = 0;
  const countingVisit = (text: string): string => {
    visited += 1;
    return visit(text);
  };
  if (typeof record.prompt === 'string') {
    record.prompt = countingVisit(record.prompt);
  }
  if (typeof record.system === 'string') {
    record.system = countingVisit(record.system);
  }
  if (Array.isArray(record.system)) {
    for (const block of record.system) {
      if (typeof block === 'string') continue; // Anthropic system blocks are objects
      mapTextBlock(block, countingVisit);
      visited += 1;
    }
  }
  if (Array.isArray(record.messages)) {
    for (const message of record.messages) {
      if (message && typeof message === 'object') {
        mapMessageContent(message as Record<string, unknown>, countingVisit);
      }
    }
  }
  // Responses `input`: string, or message/input_text items.
  if (typeof record.input === 'string') {
    record.input = countingVisit(record.input);
  } else if (Array.isArray(record.input)) {
    for (const item of record.input) {
      if (!item || typeof item !== 'object') continue;
      const entry = item as Record<string, unknown>;
      if (typeof entry.content === 'string') {
        entry.content = countingVisit(entry.content);
      } else if (Array.isArray(entry.content)) {
        for (const block of entry.content) mapTextBlock(block, countingVisit);
        visited += 1;
      }
    }
  }
  return visited;
}

/** Collect every inbound prompt string without rewriting (for block checks). */
export function collectInboundText(body: unknown): string[] {
  const out: string[] = [];
  mapInboundText(body, text => {
    out.push(text);
    return text;
  });
  return out;
}

/** Rewrite every completion string in a non-streaming response body. */
export function mapOutboundText(body: unknown, visit: TextVisitor): number {
  if (!body || typeof body !== 'object') return 0;
  const record = body as Record<string, unknown>;
  let visited = 0;
  const countingVisit = (text: string): string => {
    visited += 1;
    return visit(text);
  };
  // OpenAI chat: choices[].message.content (string or blocks).
  if (Array.isArray(record.choices)) {
    for (const choice of record.choices) {
      const message = (choice as Record<string, unknown> | null)?.message;
      if (message && typeof message === 'object') {
        mapMessageContent(message as Record<string, unknown>, countingVisit);
      }
    }
  }
  // Anthropic: content[] text blocks.
  if (Array.isArray(record.content)) {
    for (const block of record.content) {
      mapTextBlock(block, countingVisit);
      visited += 1;
    }
  }
  // Responses: output[] with content[].text, plus output_text shortcut.
  if (Array.isArray(record.output)) {
    for (const item of record.output) {
      if (!item || typeof item !== 'object') continue;
      const content = (item as Record<string, unknown>).content;
      if (Array.isArray(content)) {
        for (const block of content) mapTextBlock(block, countingVisit);
        visited += 1;
      }
    }
  }
  if (typeof record.output_text === 'string') {
    record.output_text = countingVisit(record.output_text);
  }
  // Ollama / completions: message.content, response.
  const message = record.message;
  if (message && typeof message === 'object') {
    mapMessageContent(message as Record<string, unknown>, countingVisit);
  }
  if (typeof record.response === 'string') {
    record.response = countingVisit(record.response);
  }
  return visited;
}
