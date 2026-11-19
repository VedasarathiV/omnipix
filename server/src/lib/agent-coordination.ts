import { getDb } from '../db/index.js';

// Group coordination primitives (Phase 3): file locks and the shared
// blackboard. DB-only on purpose — agent-tools.ts calls into this module,
// so it must not import the orchestrator or the runtime (import cycle).

export interface BlackboardEntry {
  key: string;
  value: unknown;
  writerTaskId: number | null;
  updatedAt: string;
}

/**
 * Claim a workspace path for a task. Re-acquiring your own lock is a no-op;
 * another task's lock throws naming the holder. Locks release when the
 * task finishes (see releaseTaskLocks) — never held across tasks.
 */
export function claimFileLock(groupId: number, taskId: number, relPath: string): void {
  const db = getDb();
  const normalized = relPath.trim().replace(/^\.\/+/, '');
  const existing = db.prepare('SELECT task_id FROM file_locks WHERE group_id = ? AND path = ?')
    .get(groupId, normalized) as { task_id: number } | undefined;
  if (!existing) {
    db.prepare('INSERT INTO file_locks (group_id, path, task_id) VALUES (?, ?, ?)')
      .run(groupId, normalized, taskId);
    return;
  }
  if (existing.task_id !== taskId) {
    throw new Error(`locked by task ${existing.task_id}: ${normalized}. Pick another file or wait for it to finish.`);
  }
}

export function releaseTaskLocks(groupId: number, taskId: number): void {
  getDb().prepare('DELETE FROM file_locks WHERE group_id = ? AND task_id = ?').run(groupId, taskId);
}

export function listFileLocks(groupId: number): Array<{ path: string; taskId: number; acquiredAt: string }> {
  const rows = getDb().prepare('SELECT path, task_id, acquired_at FROM file_locks WHERE group_id = ? ORDER BY path')
    .all(groupId) as { path: string; task_id: number; acquired_at: string }[];
  return rows.map(row => ({ path: row.path, taskId: row.task_id, acquiredAt: row.acquired_at }));
}

const BLACKBOARD_MAX_VALUE_CHARS = 4000;

/** Write one blackboard key (upsert). Values are capped; keys are capped. */
export function blackboardWrite(groupId: number, taskId: number | null, key: string, value: unknown): void {
  const clean = key.trim().slice(0, 128);
  if (!clean) throw new Error('blackboard key must be a non-empty string');
  const full = JSON.stringify(value ?? null);
  // A raw slice would break JSON validity — oversized values become an
  // explicit truncated-text marker instead.
  const json = full.length > BLACKBOARD_MAX_VALUE_CHARS
    ? JSON.stringify({ __truncated_text: full.slice(0, BLACKBOARD_MAX_VALUE_CHARS) })
    : full;
  getDb().prepare(
    `INSERT INTO blackboard (group_id, key, value_json, writer_task_id, updated_at)
     VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(group_id, key) DO UPDATE SET value_json = excluded.value_json,
       writer_task_id = excluded.writer_task_id, updated_at = excluded.updated_at`,
  ).run(groupId, clean, json, taskId);
}

export function blackboardRead(groupId: number, key: string): BlackboardEntry | null {
  const row = getDb().prepare('SELECT key, value_json, writer_task_id, updated_at FROM blackboard WHERE group_id = ? AND key = ?')
    .get(groupId, key.trim()) as { key: string; value_json: string; writer_task_id: number | null; updated_at: string } | undefined;
  if (!row) return null;
  return { key: row.key, value: JSON.parse(row.value_json), writerTaskId: row.writer_task_id, updatedAt: row.updated_at };
}

export function blackboardList(groupId: number): BlackboardEntry[] {
  const rows = getDb().prepare('SELECT key, value_json, writer_task_id, updated_at FROM blackboard WHERE group_id = ? ORDER BY key')
    .all(groupId) as { key: string; value_json: string; writer_task_id: number | null; updated_at: string }[];
  return rows.map(row => ({ key: row.key, value: JSON.parse(row.value_json), writerTaskId: row.writer_task_id, updatedAt: row.updated_at }));
}

/** Resolve the group+task owning a run, for group-scoped tools. */
export function taskForRun(runId: number): { groupId: number; taskId: number } | null {
  const row = getDb().prepare('SELECT group_id, id FROM agent_tasks WHERE run_id = ?')
    .get(runId) as { group_id: number; id: number } | undefined;
  return row ? { groupId: row.group_id, taskId: row.id } : null;
}
