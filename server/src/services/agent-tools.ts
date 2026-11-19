import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../db/index.js';
import { runSearch } from './search.js';
import { detectChecks, runCheck } from './agent-verify.js';
import { callMcpTool, listMcpTools, parseQualifiedName } from './mcp-servers.js';
import { listMemories } from './memories.js';
import { docsPromptSection, searchDocs } from './docs-ingest.js';
import { blackboardList, blackboardRead, blackboardWrite, claimFileLock, taskForRun } from '../lib/agent-coordination.js';
import { proposeMemory } from './learning-loop.js';
import { resolveFusionCandidate } from './router.js';
import { execShell, grepSearch, resolveInRoot, runWorkspace } from '../lib/workspace.js';
import { isBlockedFetchUrl } from '../lib/fetch-guard.js';
import type { ChatToolDefinition } from '@omnipix/shared/types.js';
import type { AgentRun } from './agent-runtime.js';

// Built-in agent tools. Every tool is provider-agnostic by construction —
// tools run in the gateway, models only choose them. Side-effecting tools
// (write_*, shell_exec, run_check) sit behind the approvals policy tier:
// the loop parks for a human decision before executing them, and the
// workspace runner confines them to the run's own directory.

export interface AgentToolContext {
  runId: number;
  signal?: AbortSignal;
  /** Live shell/check output subscriber (terminal view). */
  onOutput?: (chunk: string, stream: 'stdout' | 'stderr') => void;
}

export interface AgentTool {
  name: string;
  definition: ChatToolDefinition;
  execute: (args: Record<string, unknown>, ctx: AgentToolContext) => Promise<string>;
  /**
   * Diff preview for approval-gated tools: what WOULD change, computed
   * without applying anything. Shown in the inbox before the operator
   * decides. Null when there is nothing meaningful to preview.
   */
  preview?: (args: Record<string, unknown>, ctx: AgentToolContext) => Promise<string | null>;
}

function strArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`missing required string argument: ${key}`);
  return value;
}

// --- calculator: recursive-descent arithmetic, no eval ---------------------
// Supports + - * / % ^, parentheses, unary minus, decimals. Anything else is
// a syntax error, so model output can never reach code execution.

function evaluateExpression(input: string): number {
  const tokens = input.replace(/\s+/g, '');
  let pos = 0;
  function peek(): string { return tokens[pos] ?? ''; }
  function parseExpr(): number {
    let value = parseTerm();
    for (;;) {
      if (peek() === '+') { pos++; value += parseTerm(); }
      else if (peek() === '-') { pos++; value -= parseTerm(); }
      else return value;
    }
  }
  function parseTerm(): number {
    let value = parseFactor();
    for (;;) {
      if (peek() === '*') { pos++; value *= parseFactor(); }
      else if (peek() === '/') { pos++; const d = parseFactor(); if (d === 0) throw new Error('division by zero'); value /= d; }
      else if (peek() === '%') { pos++; value %= parseFactor(); }
      else return value;
    }
  }
  function parseFactor(): number {
    let value = parseUnary();
    if (peek() === '^') { pos++; value = Math.pow(value, parseFactor()); }
    return value;
  }
  function parseUnary(): number {
    if (peek() === '-') { pos++; return -parseUnary(); }
    if (peek() === '+') { pos++; return parseUnary(); }
    return parsePrimary();
  }
  function parsePrimary(): number {
    if (peek() === '(') {
      pos++;
      const value = parseExpr();
      if (peek() !== ')') throw new Error(`expected ')' at position ${pos}`);
      pos++;
      return value;
    }
    const match = /^[0-9]*\.?[0-9]+/.exec(tokens.slice(pos));
    if (!match) throw new Error(`unexpected '${peek() || 'end'}' at position ${pos}`);
    pos += match[0].length;
    return Number(match[0]);
  }
  if (!tokens) throw new Error('empty expression');
  const value = parseExpr();
  if (pos < tokens.length) throw new Error(`unexpected '${peek()}' at position ${pos}`);
  if (!Number.isFinite(value)) throw new Error('result is not finite');
  return value;
}

// --- fetch_url guards ------------------------------------------------------

const FETCH_MAX_BYTES = 100_000;
const FETCH_TIMEOUT_MS = 15_000;

async function fetchUrlText(raw: string, signal?: AbortSignal): Promise<string> {
  const blocked = isBlockedFetchUrl(raw);
  if (blocked) throw new Error(blocked);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(raw, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'omnipix-agent/1.0', accept: 'text/html,text/plain,*/*' },
    });
    // Re-check after redirects: a public URL must not bounce into the VPC.
    const finalBlocked = isBlockedFetchUrl(res.url || raw);
    if (finalBlocked) throw new Error(`redirect target blocked: ${finalBlocked}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = res.headers.get('content-type') ?? '';
    if (!/text\/|json|xml/i.test(contentType)) throw new Error(`refusing non-text content (${contentType || 'unknown'})`);
    const text = await res.text();
    const stripped = text.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return stripped.slice(0, FETCH_MAX_BYTES);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function toolDefinition(name: string, description: string, properties: Record<string, unknown>, required: string[]): ChatToolDefinition {
  return {
    type: 'function',
    function: { name, description, parameters: { type: 'object', properties, required } },
  };
}

export const AGENT_TOOLS: AgentTool[] = [
  {
    name: 'calculator',
    definition: toolDefinition(
      'calculator',
      'Evaluate an arithmetic expression (+ - * / % ^, parentheses, decimals). No variables or functions.',
      { expression: { type: 'string', description: 'The expression, e.g. "(12 + 8) / 4".' } },
      ['expression'],
    ),
    execute: async (args) => String(evaluateExpression(strArg(args, 'expression'))),
  },
  {
    name: 'current_time',
    definition: toolDefinition(
      'current_time',
      'The current date and time in ISO 8601 UTC, plus the requested IANA timezone rendering.',
      { timezone: { type: 'string', description: 'IANA timezone, e.g. America/New_York. Defaults to UTC.' } },
      [],
    ),
    execute: async (args) => {
      const now = new Date();
      const timezone = typeof args.timezone === 'string' && args.timezone ? args.timezone : 'UTC';
      try {
        return `${now.toISOString()} (${new Intl.DateTimeFormat('en-US', { timeZone: timezone, dateStyle: 'full', timeStyle: 'long' }).format(now)})`;
      } catch {
        throw new Error(`unknown timezone: ${timezone}`);
      }
    },
  },
  {
    name: 'web_search',
    definition: toolDefinition(
      'web_search',
      'Search the web across the gateway\'s configured search engines. Returns titles, URLs, and snippets.',
      {
        query: { type: 'string', description: 'The search query.' },
        maxResults: { type: 'number', description: 'How many hits (1-10, default 5).' },
      },
      ['query'],
    ),
    execute: async (args, ctx) => {
      const query = strArg(args, 'query');
      const maxResults = typeof args.maxResults === 'number'
        ? Math.min(10, Math.max(1, Math.floor(args.maxResults)))
        : 5;
      const res = await runSearch(query, { maxResults, clientAgent: 'omnipix-agent', signal: ctx.signal });
      const lines = res.results.map((hit, i) => `${i + 1}. ${hit.title}\n   ${hit.url}\n   ${hit.content.slice(0, 500)}`);
      return [`provider: ${res.provider} (${res.engine})`, ...lines].join('\n');
    },
  },
  {
    name: 'fetch_url',
    definition: toolDefinition(
      'fetch_url',
      'Fetch a PUBLIC http(s) URL and return its text (scripts/styles stripped, capped). Loopback and private-network hosts are refused.',
      { url: { type: 'string', description: 'The full http(s) URL to fetch.' } },
      ['url'],
    ),
    execute: async (args, ctx) => fetchUrlText(strArg(args, 'url'), ctx.signal),
  },
  {
    name: 'memory_write',
    definition: toolDefinition(
      'memory_write',
      'Store a short fact for this run (decisions, intermediate results). Overwrites the same key.',
      {
        key: { type: 'string', description: 'Short key, e.g. "shortlist".' },
        value: { type: 'string', description: 'The fact to remember (cap ~2000 chars).' },
      },
      ['key', 'value'],
    ),
    execute: async (args, ctx) => {
      const key = strArg(args, 'key').slice(0, 128);
      const value = strArg(args, 'value').slice(0, 2000);
      getDb().prepare('INSERT INTO agent_memory (run_id, key, value) VALUES (?, ?, ?) ON CONFLICT(run_id, key) DO UPDATE SET value = excluded.value')
        .run(ctx.runId, key, value);
      return `remembered ${key}`;
    },
  },
  {
    name: 'memory_read',
    definition: toolDefinition(
      'memory_read',
      'Read back a fact stored earlier in this run, or list keys when omitted.',
      { key: { type: 'string', description: 'The key to read. Omit to list all keys.' } },
      [],
    ),
    execute: async (args, ctx) => {
      const db = getDb();
      if (typeof args.key === 'string' && args.key) {
        const row = db.prepare('SELECT value FROM agent_memory WHERE run_id = ? AND key = ?').get(ctx.runId, args.key) as { value: string } | undefined;
        return row ? row.value : `no memory for key: ${args.key}`;
      }
      const rows = db.prepare('SELECT key FROM agent_memory WHERE run_id = ? ORDER BY key').all(ctx.runId) as { key: string }[];
      return rows.length ? rows.map(r => r.key).join(', ') : 'no memories stored';
    },
  },
];

// --- workspace tools -------------------------------------------------------
// Confined to runWorkspace(ctx.runId) through resolveInRoot. Caps keep one
// file read from eating the context window.

const READ_MAX_BYTES = 100 * 1024;
const READ_MAX_LINES = 2000;

function readNumbered(abs: string, offset: number, limit: number): string {
  const stat = fs.statSync(abs);
  if (!stat.isFile()) throw new Error('not a file');
  if (stat.size > READ_MAX_BYTES * 4) throw new Error(`file too large (${stat.size} bytes)`);
  const content = fs.readFileSync(abs, 'utf8');
  if (content.includes('\0')) throw new Error('binary file, refusing to read as text');
  const lines = content.split('\n');
  const start = Math.min(Math.max(0, offset), lines.length);
  const slice = lines.slice(start, start + Math.min(READ_MAX_LINES, Math.max(1, limit)));
  return slice.map((text, i) => `${start + i + 1}\t${text}`).join('\n');
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at >= 0) {
    count++;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return count;
}

/**
 * Claim a group file lock for a file mutation. Standalone runs (no group)
 * skip locking entirely — there is nobody to collide with.
 */
function claimGroupLock(runId: number, rel: string): void {
  const task = taskForRun(runId);
  if (task) claimFileLock(task.groupId, task.taskId, rel);
}

/** Unified-diff-ish hunk for a find/replace pair, for approval previews. */
export function renderEditPreview(rel: string, before: string, after: string): string {
  const head = `--- a/${rel}\n+++ b/${rel}`;
  const del = before.split('\n').map(l => `-${l}`).join('\n');
  const add = after.split('\n').map(l => `+${l}`).join('\n');
  return `${head}\n@@ edit @@\n${del}\n${add}`;
}

const WORKSPACE_TOOLS: AgentTool[] = [
  {
    name: 'read_file',
    definition: toolDefinition(
      'read_file',
      'Read a workspace file with 1-based line numbers. Paginate large files with offset/limit.',
      {
        path: { type: 'string', description: 'Workspace-relative path, e.g. "src/index.ts".' },
        offset: { type: 'number', description: '0-based line offset to start at. Default 0.' },
        limit: { type: 'number', description: 'Max lines to return. Default 200, max 2000.' },
      },
      ['path'],
    ),
    execute: async (args, ctx) => {
      const root = runWorkspace(ctx.runId);
      const abs = resolveInRoot(root, strArg(args, 'path'));
      const offset = typeof args.offset === 'number' ? Math.floor(args.offset) : 0;
      const limit = typeof args.limit === 'number' ? Math.floor(args.limit) : 200;
      try {
        return readNumbered(abs, offset, limit);
      } catch (err) {
        throw new Error(`cannot read ${strArg(args, 'path')}: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  },
  {
    name: 'grep_search',
    definition: toolDefinition(
      'grep_search',
      'Fixed-string search across workspace files (ripgrep when installed). Skips node_modules, .git, build output.',
      {
        pattern: { type: 'string', description: 'Literal text to find (not a regex).' },
        limit: { type: 'number', description: 'Max matches. Default 50, max 200.' },
      },
      ['pattern'],
    ),
    execute: async (args, ctx) => {
      const root = runWorkspace(ctx.runId);
      const matches = grepSearch(root, strArg(args, 'pattern'), typeof args.limit === 'number' ? args.limit : 50);
      if (!matches.length) return 'no matches';
      return matches.map(m => `${m.file}:${m.line}: ${m.text}`).join('\n');
    },
  },
  {
    name: 'write_file',
    definition: toolDefinition(
      'write_file',
      'Create or fully overwrite a workspace file. Parent directories are created. Prefer edit_file for small changes.',
      {
        path: { type: 'string', description: 'Workspace-relative path.' },
        content: { type: 'string', description: 'Complete new file content.' },
      },
      ['path', 'content'],
    ),
    preview: async (args, ctx) => {
      const root = runWorkspace(ctx.runId);
      const rel = strArg(args, 'path');
      const abs = resolveInRoot(root, rel);
      const next = typeof args.content === 'string' ? args.content : '';
      const prev = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
      if (!prev) {
        const added = next.split('\n').slice(0, 100).map(l => `+${l}`).join('\n');
        return `--- /dev/null\n+++ b/${rel}\n@@ new file @@\n${added}`;
      }
      return renderEditPreview(rel, prev.split('\n').slice(0, 60).join('\n'), next.split('\n').slice(0, 60).join('\n'));
    },
    execute: async (args, ctx) => {
      const root = runWorkspace(ctx.runId);
      const abs = resolveInRoot(root, strArg(args, 'path'));
      claimGroupLock(ctx.runId, strArg(args, 'path'));
      const content = typeof args.content === 'string' ? args.content : '';
      if (content.includes('\0')) throw new Error('refusing to write binary content');
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, 'utf8');
      return `wrote ${strArg(args, 'path')} (${content.split('\n').length} lines)`;
    },
  },
  {
    name: 'edit_file',
    definition: toolDefinition(
      'edit_file',
      'Replace one exact text block in a workspace file. Fails unless the find block matches exactly once — include surrounding context.',
      {
        path: { type: 'string', description: 'Workspace-relative path.' },
        find: { type: 'string', description: 'Exact text to replace (must occur exactly once).' },
        replace: { type: 'string', description: 'Replacement text.' },
      },
      ['path', 'find', 'replace'],
    ),
    preview: async args => {
      const find = typeof args.find === 'string' ? args.find : '';
      const replace = typeof args.replace === 'string' ? args.replace : '';
      if (!find) return null;
      return renderEditPreview(strArg(args, 'path'), find, replace);
    },
    execute: async (args, ctx) => {
      const root = runWorkspace(ctx.runId);
      const rel = strArg(args, 'path');
      const abs = resolveInRoot(root, rel);
      claimGroupLock(ctx.runId, rel);
      const find = strArg(args, 'find');
      const replace = typeof args.replace === 'string' ? args.replace : '';
      let content: string;
      try {
        content = fs.readFileSync(abs, 'utf8');
      } catch {
        throw new Error(`cannot read ${rel}: file does not exist`);
      }
      const count = countOccurrences(content, find);
      if (count === 0) throw new Error(`find block matches 0 times in ${rel} — include more surrounding context`);
      if (count > 1) throw new Error(`find block matches ${count} times in ${rel} — narrow it with more surrounding context`);
      fs.writeFileSync(abs, content.replace(find, replace), 'utf8');
      return `edited ${rel}`;
    },
  },
  {
    name: 'shell_exec',
    definition: toolDefinition(
      'shell_exec',
      'Run a shell command in the workspace (cwd locked, timeout, destructive patterns denied). Returns exit code + capped output.',
      {
        command: { type: 'string', description: 'The command to run.' },
        timeoutMs: { type: 'number', description: 'Wall-clock timeout in ms. Default 60000, max 300000.' },
      },
      ['command'],
    ),
    execute: async (args, ctx) => {
      const root = runWorkspace(ctx.runId);
      const timeoutMs = typeof args.timeoutMs === 'number'
        ? Math.min(300_000, Math.max(1000, Math.floor(args.timeoutMs)))
        : undefined;
      const result = await execShell(strArg(args, 'command'), {
        cwd: root,
        timeoutMs,
        onOutput: ctx.onOutput,
      });
      if (ctx.signal?.aborted) throw new Error('stopped');
      const head = `exit=${result.exitCode ?? 'null'}${result.timedOut ? ' TIMED OUT' : ''}${result.truncated ? ' (output truncated)' : ''} [${result.sandbox}]`;
      const body = `${result.stdout}\n${result.stderr}`.trim();
      return body ? `${head}\n${body}` : head;
    },
  },
  {
    name: 'run_check',
    definition: toolDefinition(
      'run_check',
      'Run one of the repo\'s own checks (auto-detected from package.json scripts or Makefile targets). Reports pass/fail with failure lines.',
      {
        name: { type: 'string', description: 'Check name, e.g. "test". Omit to list detected checks.' },
      },
      [],
    ),
    execute: async (args, ctx) => {
      const root = runWorkspace(ctx.runId);
      const checks = detectChecks(root);
      if (typeof args.name !== 'string' || !args.name) {
        return checks.length
          ? checks.map(c => `${c.name}: ${c.command}`).join('\n')
          : 'no checks detected (no package.json scripts or Makefile targets)';
      }
      const check = checks.find(c => c.name === args.name);
      if (!check) throw new Error(`unknown check: ${args.name}. Detected: ${checks.map(c => c.name).join(', ') || 'none'}`);
      const result = await runCheck(root, check, { onOutput: ctx.onOutput });
      if (ctx.signal?.aborted) throw new Error('stopped');
      return result.pass
        ? `PASS ${result.name}`
        : `FAIL ${result.name} (exit ${result.exitCode ?? 'null'})${result.timedOut ? ' TIMED OUT' : ''}\n${result.summary}`;
    },
  },
];

for (const tool of WORKSPACE_TOOLS) AGENT_TOOLS.push(tool);

// --- blackboard tools ------------------------------------------------------
// Group scratch space: teammates publish findings here. Read tier (auto) —
// confined to the group's own scratch, so approvals would only add friction.
// Outside a group both tools error plainly.

function groupFor(ctx: { runId: number }): { groupId: number; taskId: number } {
  const task = taskForRun(ctx.runId);
  if (!task) throw new Error('blackboard tools need a group run — this run is standalone');
  return task;
}

const BLACKBOARD_TOOLS: AgentTool[] = [
  {
    name: 'blackboard_read',
    definition: toolDefinition(
      'blackboard_read',
      'Read a shared finding from the team blackboard. Omit key to list all keys.',
      { key: { type: 'string', description: 'The key to read. Omit to list all keys.' } },
      [],
    ),
    execute: async (args, ctx) => {
      const { groupId } = groupFor(ctx);
      if (typeof args.key === 'string' && args.key) {
        const entry = blackboardRead(groupId, args.key);
        return entry ? JSON.stringify(entry.value) : `no blackboard entry for key: ${args.key}`;
      }
      const entries = blackboardList(groupId);
      return entries.length ? entries.map(e => e.key).join(', ') : 'blackboard is empty';
    },
  },
  {
    name: 'blackboard_write',
    definition: toolDefinition(
      'blackboard_write',
      'Publish a finding for teammate tasks (decisions, file lists, results). Overwrites the same key.',
      {
        key: { type: 'string', description: 'Short key, e.g. "api-shape".' },
        value: { type: 'string', description: 'The finding (cap ~4000 chars).' },
      },
      ['key', 'value'],
    ),
    execute: async (args, ctx) => {
      const { groupId, taskId } = groupFor(ctx);
      blackboardWrite(groupId, taskId, strArg(args, 'key'), strArg(args, 'value'));
      return `published ${strArg(args, 'key')}`;
    },
  },
];

for (const tool of BLACKBOARD_TOOLS) AGENT_TOOLS.push(tool);

// --- long-term memory tools ------------------------------------------------
// remember persists across runs (write tier → approval-gated); values are
// PII-redacted at write time. recall_memory searches on demand (read tier).

const MEMORY_TOOLS: AgentTool[] = [
  {
    name: 'remember',
    definition: toolDefinition(
      'remember',
      'Propose a durable memory (user preference, project convention, or entity fact) for future runs. The operator reviews it before it takes effect; values are PII-scrubbed on accept.',
      {
        key: { type: 'string', description: 'Short key, e.g. "commit-style".' },
        value: { type: 'string', description: 'The fact to remember.' },
        scope: { type: 'string', description: '"user" (default), "project", or "entity" (a person, team, or thing).' },
        project: { type: 'string', description: 'Project key for project scope. Defaults to this run\'s project.' },
        importance: { type: 'number', description: '0..1, how much this should resist decay. Default 0.5.' },
      },
      ['key', 'value'],
    ),
    execute: async (args, ctx) => {
      const scope = args.scope === 'project' || args.scope === 'entity' ? args.scope : 'user';
      const project = typeof args.project === 'string' && args.project.trim()
        ? args.project.trim()
        : runProjectKey(ctx.runId);
      // Quarantined, not written: agent memories go through the operator's
      // review queue (learning proposals) so a confused or injected run
      // cannot persist its own instructions into every future prompt.
      const id = proposeMemory({
        scope,
        projectKey: project,
        key: strArg(args, 'key'),
        value: strArg(args, 'value'),
        importance: typeof args.importance === 'number' ? args.importance : undefined,
        runId: ctx.runId,
      });
      return `memory proposal #${id} queued for operator review (key: ${strArg(args, 'key')})`;
    },
  },
  {
    name: 'recall_docs',
    definition: toolDefinition(
      'recall_docs',
      'Search ingested project docs by keyword. Use this when the task references docs, specs, or READMEs the operator ingested.',
      {
        query: { type: 'string', description: 'Keywords to search for.' },
        project: { type: 'string', description: 'Project key. Defaults to this run\'s project.' },
      },
      ['query'],
    ),
    execute: async (args, ctx) => {
      const project = typeof args.project === 'string' && args.project.trim()
        ? args.project.trim()
        : runProjectKey(ctx.runId);
      if (!project) return 'this run has no project; pass explicit project to search docs';
      const hits = searchDocs(project, strArg(args, 'query'));
      if (!hits.length) return `no doc chunks match in project "${project}"`;
      return docsPromptSection(hits).trim();
    },
  },
  {
    name: 'recall_memory',
    definition: toolDefinition(
      'recall_memory',
      'Search long-term memory by keyword. Top user, project, and entity memories already inject automatically; use this to dig.',
      { query: { type: 'string', description: 'Keyword to search for. Omit to list top memories.' } },
      [],
    ),
    execute: async (args, ctx) => {
      const project = runProjectKey(ctx.runId);
      const all = [...listMemories('user'), ...listMemories('entity'), ...(project ? listMemories('project', project) : [])];
      const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
      const hits = (query
        ? all.filter(m => `${m.key} ${m.value}`.toLowerCase().includes(query))
        : all
      ).slice(0, 10);
      if (!hits.length) return query ? `no memories match "${query}"` : 'no memories stored';
      return hits.map(m => `[${m.scope}] ${m.key}: ${m.value}`).join('\n');
    },
  },
  {
    name: 'find_skill',
    definition: toolDefinition(
      'find_skill',
      'Search the skill library by keyword and read full instructions. Two skills auto-load per run; use this to discover and read any other.',
      {
        query: { type: 'string', description: 'Keywords, e.g. "kubernetes" or "sales discovery". Omit to list names.' },
        full: { type: 'boolean', description: 'Include full instructions (capped). Default: names + descriptions only.' },
      },
      [],
    ),
    execute: async (args) => {
      const { listSkills } = await import('./agent-runtime.js');
      const all = listSkills().filter(s => s.enabled);
      const words = typeof args.query === 'string'
        ? args.query.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2)
        : [];
      const scored = all
        .map(skill => {
          const name = skill.name.toLowerCase();
          const desc = skill.description.toLowerCase();
          let score = 0;
          for (const word of words) {
            if (name.includes(word)) score += 3;
            else if (desc.includes(word)) score += 2;
          }
          return { skill, score };
        })
        .filter(e => !words.length || e.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, words.length ? 5 : 40);
      if (!scored.length) return `no skills match "${args.query}"`;
      const full = args.full === true;
      return scored.map(({ skill }) => {
        const head = `${skill.name}: ${skill.description}`;
        if (!full) return head;
        return `${head}\n${skill.instructions.slice(0, 3000)}${skill.instructions.length > 3000 ? '\n…(truncated)' : ''}`;
      }).join('\n\n');
    },
  },
];

for (const tool of MEMORY_TOOLS) AGENT_TOOLS.push(tool);

// --- git tools ---------------------------------------------------------------
// Version control for workspaces. Read-only inspection is free; anything that
// writes history needs approval like any other write. Requires a git binary;
// teams share one repo dir, so commits from different tasks interleave by
// time (file locks still prevent same-file write collisions).

let gitPresent: boolean | null = null;

function gitBinary(): string | null {
  if (gitPresent !== null) return gitPresent ? 'git' : null;
  try {
    const probed = spawnSync('git', ['--version'], { encoding: 'utf8', timeout: 5000 });
    gitPresent = probed.status === 0;
  } catch {
    gitPresent = false;
  }
  return gitPresent ? 'git' : null;
}

async function gitRun(
  ctx: AgentToolContext,
  gitArgs: string[],
  opts?: { timeoutMs?: number },
): Promise<string> {
  if (!gitBinary()) throw new Error('git is not installed in this environment');
  const root = runWorkspace(ctx.runId);
  // No shell: argv array, so ref/branch names cannot inject commands.
  return new Promise<string>((resolve, reject) => {
    const child = spawn('git', ['-C', root, ...gitArgs], {
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
      timeout: opts?.timeoutMs ?? 60_000,
      windowsHide: true,
    });
    let out = '';
    let err = '';
    child.stdout?.on('data', (d: Buffer) => { out += d.toString('utf8'); });
    child.stderr?.on('data', (d: Buffer) => { err += d.toString('utf8'); });
    child.on('error', (e: Error) => reject(new Error(`git failed: ${e.message}`)));
    child.on('close', (code: number | null) => {
      if (code !== 0) {
        reject(new Error(`git ${gitArgs[0]} failed: ${(err || out).trim().slice(0, 1000) || `exit ${code}`}`));
        return;
      }
      resolve(out.trim() || '(no output)');
    });
  });
}

function gitRefArg(value: unknown, what: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`missing ${what}`);
  const ref = value.trim();
  // Ref/branch allowlist: git's own check-ref-format rules approximated.
  // Rejects .., @{, control chars, and shell metacharacters outright.
  if (!/^[A-Za-z0-9][A-Za-z0-9._\-/]*$/.test(ref) || ref.includes('..') || ref.includes('@{')) {
    throw new Error(`invalid ${what}: ${ref}`);
  }
  return ref;
}

const GIT_TOOLS: AgentTool[] = [
  {
    name: 'git_status',
    definition: toolDefinition(
      'git_status',
      'Show working-tree status (short format) for the workspace repo.',
      {},
      [],
    ),
    execute: async (_args, ctx) => gitRun(ctx, ['status', '--short', '--branch']),
  },
  {
    name: 'git_diff',
    definition: toolDefinition(
      'git_diff',
      'Show the unified diff of uncommitted changes (truncated).',
      {
        staged: { type: 'boolean', description: 'Diff staged changes instead. Default false.' },
        path: { type: 'string', description: 'Limit the diff to one workspace-relative path.' },
      },
      [],
    ),
    execute: async (args, ctx) => {
      const extra: string[] = args.staged === true ? ['--cached'] : [];
      if (typeof args.path === 'string' && args.path) {
        const root = runWorkspace(ctx.runId);
        resolveInRoot(root, args.path); // confinement check only
        extra.push('--', args.path);
      }
      const out = await gitRun(ctx, ['diff', ...extra]);
      return out.slice(0, 8000);
    },
  },
  {
    name: 'git_log',
    definition: toolDefinition(
      'git_log',
      'Show recent commits (one line each).',
      { limit: { type: 'number', description: 'Max commits. Default 10, max 50.' } },
      [],
    ),
    execute: async (args, ctx) => {
      const limit = typeof args.limit === 'number' ? Math.min(50, Math.max(1, Math.floor(args.limit))) : 10;
      return gitRun(ctx, ['log', `--max-count=${limit}`, '--pretty=format:%h %s']);
    },
  },
  {
    name: 'git_branch',
    definition: toolDefinition(
      'git_branch',
      'List branches, or create and switch to a new branch.',
      { name: { type: 'string', description: 'Branch to create and check out. Omit to list.' } },
      [],
    ),
    execute: async (args, ctx) => {
      if (typeof args.name === 'string' && args.name) {
        await gitRun(ctx, ['checkout', '-b', gitRefArg(args.name, 'branch name')]);
        return `switched to branch ${args.name}`;
      }
      return gitRun(ctx, ['branch', '--show-current'])
        .then(current => gitRun(ctx, ['branch', '--format=%(refname:short)']).then(all => `current: ${current}\n${all}`));
    },
  },
  {
    name: 'git_commit',
    definition: toolDefinition(
      'git_commit',
      'Stage all tracked modifications and commit with a message. New files must already exist in the workspace.',
      { message: { type: 'string', description: 'Commit message.' } },
      ['message'],
    ),
    preview: async (args, ctx) => {
      const out = await gitRun(ctx, ['diff', '--stat']).catch(() => '');
      return out ? `About to commit:\n${out.slice(0, 2000)}` : null;
    },
    execute: async (args, ctx) => {
      const message = strArg(args, 'message').slice(0, 500);
      await gitRun(ctx, ['add', '-A']);
      return gitRun(ctx, ['commit', '-m', message, '--no-verify']);
    },
  },
  {
    name: 'git_clone',
    definition: toolDefinition(
      'git_clone',
      'Clone a repository into the workspace (empty dir, or a subdir). Nothing is cloned twice.',
      {
        url: { type: 'string', description: 'https/http/file/ssh clone URL.' },
        dir: { type: 'string', description: 'Subdirectory to clone into. Default: repo name from the URL.' },
      },
      ['url'],
    ),
    execute: async (args, ctx) => {
      const url = strArg(args, 'url');
      if (!/^(https?|file|ssh|git):\/\/.+/.test(url) && !/^[\w.-]+@[\w.-]+:.+/.test(url)) {
        throw new Error('clone URL must be http(s), ssh, file, or scp-like syntax');
      }
      const root = runWorkspace(ctx.runId);
      const fallback = (url.split('/').pop() ?? 'repo').replace(/\.git$/, '') || 'repo';
      const dir = typeof args.dir === 'string' && args.dir ? args.dir : fallback;
      const abs = resolveInRoot(root, dir);
      if (fs.existsSync(abs) && fs.readdirSync(abs).length > 0) {
        throw new Error(`clone target is not empty: ${dir}`);
      }
      fs.mkdirSync(abs, { recursive: true });
      await new Promise<void>((resolve, reject) => {
        const child = spawn('git', ['clone', '--depth', '1', url, abs], {
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
          timeout: 180_000,
          windowsHide: true,
        });
        let err = '';
        child.stderr?.on('data', (d: Buffer) => { err += d.toString('utf8'); });
        child.on('error', (e: Error) => reject(new Error(`git clone failed: ${e.message}`)));
        child.on('close', (code: number | null) => {
          if (code !== 0) reject(new Error(`git clone failed: ${err.trim().slice(0, 1000) || `exit ${code}`}`));
          else resolve();
        });
      });
      return `cloned into ${dir}`;
    },
  },
];

for (const tool of GIT_TOOLS) AGENT_TOOLS.push(tool);

// --- delegate: in-run subagents ----------------------------------------------
// Spawns a child run with its own context (message history, steps, trace)
// that executes synchronously and reports back. The child shares the
// parent's workspace and session but is an independent run row, so its
// risky tools still park in the approvals inbox individually. Depth-capped:
// runaway delegation trees are a cost and context hazard.

const DELEGATE_MAX_DEPTH = 3;
const DELEGATE_DEFAULT_STEPS = 8;
const DELEGATE_MAX_STEPS = 25;

/** Nesting depth of a run: 0 for roots, +1 per delegation. */
function delegationDepth(runId: number): number {
  let depth = 0;
  let current: number | null = runId;
  const seen = new Set<number>([runId]);
  for (let i = 0; i < 8; i++) {
    const row = getDb().prepare('SELECT parent_run_id FROM agent_runs WHERE id = ?').get(current) as { parent_run_id?: number | null } | undefined;
    if (!row?.parent_run_id || seen.has(row.parent_run_id)) break;
    seen.add(row.parent_run_id);
    current = row.parent_run_id;
    depth++;
  }
  return depth;
}

const DELEGATE_TOOLS: AgentTool[] = [
  {
    name: 'delegate',
    definition: toolDefinition(
      'delegate',
      'Spawn a subagent run with its own context to handle a subtask, and wait for its report. The child shares your workspace and session; its writes and shell commands still need approval like yours. Prefer this for parallelizable or context-heavy subtasks you do not need to do inline.',
      {
        goal: { type: 'string', description: 'The subtask for the child run.' },
        tools: { type: 'array', items: { type: 'string' }, description: 'Tool allowlist for the child. Defaults to your tools minus delegate.' },
        maxSteps: { type: 'number', description: `Child step budget, 1..${DELEGATE_MAX_STEPS}. Default ${DELEGATE_DEFAULT_STEPS}.` },
        model: { type: 'string', description: 'Model for the child run (any enabled /v1/models id, or auto). Defaults to your model. Use a cheaper model for mechanical subtasks.' },
      },
      ['goal'],
    ),
    execute: async (args, ctx) => {
      const goal = strArg(args, 'goal');
      if (goal.length > 8000) throw new Error('goal must be at most 8000 characters');
      if (delegationDepth(ctx.runId) >= DELEGATE_MAX_DEPTH) {
        throw new Error(`delegate depth limit reached (${DELEGATE_MAX_DEPTH}); do this subtask inline instead`);
      }
      const maxSteps = args.maxSteps === undefined ? DELEGATE_DEFAULT_STEPS : args.maxSteps;
      if (typeof maxSteps !== 'number' || !Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > DELEGATE_MAX_STEPS) {
        throw new Error(`maxSteps must be an integer 1..${DELEGATE_MAX_STEPS}`);
      }
      // Dynamic import: agent-runtime imports this registry, so a static
      // import would cycle. Deferred to call time, the module is loaded.
      const runtime = await import('./agent-runtime.js');
      const parent = runtime.getAgentRun(ctx.runId);
      if (!parent) throw new Error(`parent run ${ctx.runId} not found`);
      let tools: string[] | undefined;
      if (args.tools !== undefined) {
        if (!Array.isArray(args.tools) || !args.tools.every(t => typeof t === 'string')) {
          throw new Error('tools must be an array of tool names');
        }
        const unknown = (args.tools as string[]).filter(t => !agentToolByName(t));
        if (unknown.length) throw new Error(`Unknown tool(s): ${unknown.join(', ')}.`);
        tools = [...new Set(args.tools as string[])];
        if (!tools.length) throw new Error('tools must not be empty');
      } else {
        tools = parent.tools.filter(t => t !== 'delegate');
        if (!tools.length) tools = ['calculator', 'current_time'];
      }
      // Per-subagent model control (#8): the child can run a different model
      // than the parent (e.g. a cheap model for mechanical subtasks).
      // Validated up front so a bad id fails before the child row exists.
      let childModel = parent.model;
      if (args.model !== undefined) {
        if (typeof args.model !== 'string' || !args.model.trim()) {
          throw new Error('model must be a non-empty model id or auto');
        }
        childModel = args.model.trim();
        if (childModel !== 'auto' && !resolveFusionCandidate(childModel, { allowGroupFallback: false })) {
          throw new Error(`Unknown or disabled model: ${childModel}. Call /v1/models for the available list.`);
        }
      }
      const childId = runtime.createAgentRun({
        goal,
        model: childModel,
        tools,
        skills: parent.skills,
        maxSteps,
        sessionId: parent.session_id ?? undefined,
        projectKey: runProjectKey(ctx.runId),
        parentRunId: ctx.runId,
      });
      let child: AgentRun;
      try {
        child = await runtime.executeAgentRun(childId, {
          goal, model: childModel, tools, skills: parent.skills, maxSteps,
          projectKey: runProjectKey(ctx.runId), signal: ctx.signal,
        });
      } catch (err: unknown) {
        // executeAgentRun only throws on setup (unknown MCP tools): land the
        // child as errored instead of leaving it running forever.
        const message = err instanceof Error ? err.message : String(err);
        getDb().prepare("UPDATE agent_runs SET status = 'error', error = ?, finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(message, childId);
        throw new Error(`child run ${childId} failed to start: ${message}`);
      }
      const tokens = child.prompt_tokens + child.completion_tokens;
      const outcome = child.status === 'done'
        ? (child.final_answer || '(empty answer)')
        : `${child.status}${child.error ? `: ${child.error}` : ''}`;
      return `child run ${child.id} [${child.status}] in ${child.steps_used} steps, ${tokens} tokens: ${outcome.slice(0, 2000)}`;
    },
  },
];

for (const tool of DELEGATE_TOOLS) AGENT_TOOLS.push(tool);

/** This run's project key ('' when the run targets no project). */
function runProjectKey(runId: number): string {
  const row = getDb().prepare('SELECT project_key FROM agent_runs WHERE id = ?').get(runId) as { project_key?: string } | undefined;
  return row?.project_key ?? '';
}

/**
 * Synthetic executor for `mcp:<server>:<tool>` names. The definition here is
 * a placeholder — real schemas come from resolveAgentTools at run start.
 * Execution dispatches to the pooled MCP connection; unknown servers fail
 * at call time with the server's own error.
 */
function mcpToolEntry(qualifiedName: string): AgentTool {
  return {
    name: qualifiedName,
    definition: toolDefinition(qualifiedName, `MCP tool ${qualifiedName}.`, {}, []),
    execute: async args => {
      const out = await callMcpTool(qualifiedName, args);
      return out.slice(0, 8000);
    },
  };
}

export function agentToolByName(name: string): AgentTool | undefined {
  const native = AGENT_TOOLS.find(t => t.name === name);
  if (native) return native;
  if (parseQualifiedName(name)) return mcpToolEntry(name);
  return undefined;
}

export function agentToolDefinitions(names?: string[]): ChatToolDefinition[] {
  const tools = names ? AGENT_TOOLS.filter(t => names.includes(t.name)) : AGENT_TOOLS;
  return tools.map(t => t.definition);
}

/**
 * Resolve a run's tool list to model-facing definitions: native tools from
 * the static registry plus live MCP schemas from enabled servers. Unknown
 * MCP names throw — the run fails fast with a naming message instead of
 * offering the model a tool that can never execute.
 */
export async function resolveAgentTools(names: string[]): Promise<ChatToolDefinition[]> {
  const defs = names
    .map(name => AGENT_TOOLS.find(t => t.name === name)?.definition)
    .filter((d): d is ChatToolDefinition => !!d);
  const wantedMcp = names.filter(name => parseQualifiedName(name));
  if (!wantedMcp.length) return defs;
  const live = await listMcpTools();
  const byQualified = new Map(live.map(t => [t.qualifiedName, t]));
  const unknown = wantedMcp.filter(name => !byQualified.has(name));
  if (unknown.length) {
    throw new Error(`Unknown MCP tool(s): ${unknown.join(', ')}. Use the dashboard Servers tab to connect the server first.`);
  }
  for (const name of wantedMcp) {
    const tool = byQualified.get(name)!;
    defs.push({
      type: 'function',
      function: {
        name,
        description: tool.description || `MCP tool ${name}.`,
        parameters: tool.inputSchema as ChatToolDefinition['function']['parameters'],
      },
    });
  }
  return defs;
}

// Exported for unit tests.
export const __testing = { evaluateExpression, isBlockedFetchUrl };
