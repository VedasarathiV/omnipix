// Migration: fork lineage on agent runs (which run this one was forked from).
// Created: 2026-11-23.
//
// parent_run_id means "shares the workspace" (delegation); a fork needs its
// OWN workspace, so lineage lives in a separate column the workspace walk
// never follows.
//
// DOWN: reversible (drops the column; lineage is display-only).

import type { Db } from '../types.js';

function hasColumn(db: Db, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return columns.some((candidate) => candidate.name === column);
}

export function up(db: Db): void {
  if (!hasColumn(db, 'agent_runs', 'forked_from_run_id')) {
    db.exec(`
      ALTER TABLE agent_runs ADD COLUMN forked_from_run_id INTEGER REFERENCES agent_runs(id) ON DELETE SET NULL;
    `);
  }
}

export function down(db: Db): void {
  if (hasColumn(db, 'agent_runs', 'forked_from_run_id')) {
    db.exec(`
      ALTER TABLE agent_runs DROP COLUMN forked_from_run_id;
    `);
  }
}
