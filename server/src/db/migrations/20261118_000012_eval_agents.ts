// Migration: unattended eval agents (gap 6).
//
// Coding-task eval items run an agent to completion with no operator
// present, so the loop auto-approves parked calls for those runs. The flag
// lives on the row so every surface can see approval was automatic —
// unattended execution must never look like a reviewed run.

import type { Db } from '../types.js';

function hasColumn(db: Db, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return columns.some((candidate) => candidate.name === column);
}

export function up(db: Db): void {
  if (!hasColumn(db, 'agent_runs', 'auto_approve')) {
    db.exec('ALTER TABLE agent_runs ADD COLUMN auto_approve INTEGER NOT NULL DEFAULT 0;');
  }
}

export function down(db: Db): void {
  if (hasColumn(db, 'agent_runs', 'auto_approve')) {
    db.exec('ALTER TABLE agent_runs DROP COLUMN auto_approve;');
  }
}
