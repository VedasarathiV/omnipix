// Migration: in-run subagents (gap 4).
//
// A child run spawned by the `delegate` tool records its parent here. The
// child shares the parent's workspace (see runWorkspace) but keeps its own
// message history, steps, and trace — dynamic mid-run fan-out, unlike the
// statically planned team groups.

import type { Db } from '../types.js';

function hasColumn(db: Db, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return columns.some((candidate) => candidate.name === column);
}

export function up(db: Db): void {
  if (!hasColumn(db, 'agent_runs', 'parent_run_id')) {
    db.exec('ALTER TABLE agent_runs ADD COLUMN parent_run_id INTEGER REFERENCES agent_runs(id) ON DELETE SET NULL;');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_agent_runs_parent ON agent_runs(parent_run_id);');
}

export function down(db: Db): void {
  db.exec('DROP INDEX IF EXISTS idx_agent_runs_parent;');
  if (hasColumn(db, 'agent_runs', 'parent_run_id')) {
    db.exec('ALTER TABLE agent_runs DROP COLUMN parent_run_id;');
  }
}
