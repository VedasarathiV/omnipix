// Migration: plan mode for single runs (gap 3).
//
// A plan-mode run drafts a plan with no tools, parks in the approvals inbox,
// and only executes after an operator approves. The flag lives on the run
// row so every surface (UI badge, CLI, history) can see which runs were
// planned — the gate itself runs in-process via the approvals waiter.

import type { Db } from '../types.js';

function hasColumn(db: Db, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return columns.some((candidate) => candidate.name === column);
}

export function up(db: Db): void {
  if (!hasColumn(db, 'agent_runs', 'plan_mode')) {
    db.exec('ALTER TABLE agent_runs ADD COLUMN plan_mode INTEGER NOT NULL DEFAULT 0;');
  }
}

export function down(db: Db): void {
  if (hasColumn(db, 'agent_runs', 'plan_mode')) {
    db.exec('ALTER TABLE agent_runs DROP COLUMN plan_mode;');
  }
}
