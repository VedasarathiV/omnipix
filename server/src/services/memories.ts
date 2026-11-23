import { getDb } from '../db/index.js';
import { redactPii } from '../lib/content-guard.js';

// Cross-run memory (Phase 4): user preferences and project conventions that
// survive any single run. Values are PII-redacted at write time. Retrieval
// scores by importance × recency × use, so stale trivia sinks below the
// injection floor instead of clogging prompts forever.

export type MemoryScope = 'user' | 'project' | 'entity';

export interface MemoryRow {
  id: number;
  scope: MemoryScope;
  project_key: string;
  key: string;
  value: string;
  importance: number;
  source: string;
  run_id: number | null;
  use_count: number;
  score: number;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
}

export const MEMORY_VALUE_MAX_CHARS = 2000;
/** Below this score a memory is never injected (still listed, deletable). */
export const MEMORY_INJECT_FLOOR = 0.05;

interface StoredMemory {
  id: number;
  scope: string;
  project_key: string;
  key: string;
  value: string;
  importance: number;
  source: string;
  run_id: number | null;
  use_count: number;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
}

/**
 * Decay score: importance shaped by recency (30-day half-life-ish curve)
 * and a use bonus that caps. Pure function of the row + now — tested.
 */
export function memoryScore(row: StoredMemory, nowMs = Date.now()): number {
  const last = row.last_used_at ?? row.updated_at;
  const ageMs = Math.max(0, nowMs - Date.parse(last));
  const ageDays = ageMs / 86_400_000;
  const recency = 1 / (1 + ageDays / 30);
  const useBonus = Math.min(0.5, row.use_count * 0.05);
  return Math.min(1, Math.max(0, row.importance * recency + useBonus));
}

function toRow(row: StoredMemory, nowMs = Date.now()): MemoryRow {
  return {
    id: row.id,
    scope: row.scope as MemoryScope,
    project_key: row.project_key,
    key: row.key,
    value: row.value,
    importance: row.importance,
    source: row.source,
    run_id: row.run_id,
    use_count: row.use_count,
    score: Math.round(memoryScore(row, nowMs) * 1000) / 1000,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_used_at: row.last_used_at,
  };
}

export interface RememberInput {
  scope?: MemoryScope;
  projectKey?: string;
  key: string;
  value: string;
  importance?: number;
  source?: string;
  runId?: number;
}

export function rememberMemory(input: RememberInput): { id: number; redactions: number } {
  const scope = input.scope ?? 'user';
  if (scope !== 'user' && scope !== 'project' && scope !== 'entity') throw new Error('scope must be user, project, or entity');
  const projectKey = scope === 'project' ? (input.projectKey?.trim() || '') : '';
  if (scope === 'project' && !projectKey) throw new Error('project memories need a project key');
  const key = input.key.trim().slice(0, 128);
  if (!key) throw new Error('memory key must be a non-empty string');
  const importance = input.importance === undefined ? 0.5 : Math.min(1, Math.max(0, input.importance));
  const redacted = redactPii(input.value.slice(0, MEMORY_VALUE_MAX_CHARS));
  const row = getDb().prepare(
    `INSERT INTO memories (scope, project_key, key, value, importance, source, run_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(scope, project_key, key) DO UPDATE SET value = excluded.value,
       importance = excluded.importance, source = excluded.source, run_id = excluded.run_id,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     RETURNING id`,
  ).get(scope, projectKey, key, redacted.text, importance, input.source ?? 'user', input.runId ?? null) as { id: number };
  return { id: row.id, redactions: redacted.redactions };
}

export function getMemory(id: number): MemoryRow | null {
  const row = getDb().prepare('SELECT * FROM memories WHERE id = ?').get(id) as StoredMemory | undefined;
  return row ? toRow(row) : null;
}

export function listMemories(scope?: MemoryScope, projectKey?: string): MemoryRow[] {
  const db = getDb();
  let rows: StoredMemory[];
  if (scope === 'project' && projectKey) {
    rows = db.prepare('SELECT * FROM memories WHERE scope = ? AND project_key = ? ORDER BY updated_at DESC').all(scope, projectKey) as StoredMemory[];
  } else if (scope) {
    rows = db.prepare('SELECT * FROM memories WHERE scope = ? ORDER BY updated_at DESC').all(scope) as StoredMemory[];
  } else {
    rows = db.prepare('SELECT * FROM memories ORDER BY updated_at DESC').all() as StoredMemory[];
  }
  const now = Date.now();
  return rows.map(row => toRow(row, now)).sort((a, b) => b.score - a.score);
}

export function deleteMemory(id: number): boolean {
  return getDb().prepare('DELETE FROM memories WHERE id = ?').run(id).changes > 0;
}

/**
 * Top memories for prompt injection: user scope plus the run's project
 * scope, above the floor, highest score first. Marks them used (bump
 * use_count/last_used) so living knowledge resists decay.
 */
export function recallForRun(projectKey: string, limit = 5): MemoryRow[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT * FROM memories WHERE scope IN ('user', 'entity') OR (scope = 'project' AND project_key = ?)`,
  ).all(projectKey) as StoredMemory[];
  const now = Date.now();
  const scored = rows.map(row => toRow(row, now))
    .filter(row => row.score >= MEMORY_INJECT_FLOOR)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(20, Math.max(1, limit)));
  if (scored.length) {
    const bump = db.prepare(
      `UPDATE memories SET use_count = use_count + 1, last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    );
    for (const row of scored) bump.run(row.id);
  }
  return scored;
}

/** Render recalled memories as a system-prompt section. Empty when none. */
export function memoryPromptSection(memories: MemoryRow[]): string {
  if (!memories.length) return '';
  const lines = memories.map(m => `- [${m.scope}${m.scope === 'project' ? `:${m.project_key}` : ''}] ${m.key}: ${m.value}`);
  return `\n\nWhat you remember (long-term memory — trust it over guesses):\n${lines.join('\n')}`;
}
