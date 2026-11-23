// Migration: per-task guardrails and QA verdicts (orchestration #3).
//
// guardrail_json holds the task's output validator ({type: llm_judge|shell,
// ...}); verdict_json holds the latest verdict ({pass, reason, kind}). The
// driver evaluates the guardrail when a task run finishes: PASS marks done,
// FAIL requeues within the task's attempt budget. One budget on purpose —
// guardrail retries consume task attempts, so behavior stays predictable.

import type { Db } from '../types.js';

function hasColumn(db: Db, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return columns.some((candidate) => candidate.name === column);
}

export function up(db: Db): void {
  if (!hasColumn(db, 'agent_tasks', 'guardrail_json')) {
    db.exec('ALTER TABLE agent_tasks ADD COLUMN guardrail_json TEXT;');
  }
  if (!hasColumn(db, 'agent_tasks', 'verdict_json')) {
    db.exec('ALTER TABLE agent_tasks ADD COLUMN verdict_json TEXT;');
  }
}

export function down(db: Db): void {
  if (hasColumn(db, 'agent_tasks', 'verdict_json')) {
    db.exec('ALTER TABLE agent_tasks DROP COLUMN verdict_json;');
  }
  if (hasColumn(db, 'agent_tasks', 'guardrail_json')) {
    db.exec('ALTER TABLE agent_tasks DROP COLUMN guardrail_json;');
  }
}
