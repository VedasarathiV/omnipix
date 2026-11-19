// Migration: structured task outputs (orchestration #8).
//
// output_json gates landing on JSON-valid output; output_file writes the
// landed answer to a workspace path. Both ride the existing verdict +
// handoff machinery — no new tables.

import type { Db } from '../types.js';

function hasColumn(db: Db, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return columns.some((candidate) => candidate.name === column);
}

export function up(db: Db): void {
  if (!hasColumn(db, 'agent_tasks', 'output_json')) {
    db.exec('ALTER TABLE agent_tasks ADD COLUMN output_json INTEGER NOT NULL DEFAULT 0;');
  }
  if (!hasColumn(db, 'agent_tasks', 'output_file')) {
    db.exec('ALTER TABLE agent_tasks ADD COLUMN output_file TEXT;');
  }
}

export function down(db: Db): void {
  if (hasColumn(db, 'agent_tasks', 'output_file')) {
    db.exec('ALTER TABLE agent_tasks DROP COLUMN output_file;');
  }
  if (hasColumn(db, 'agent_tasks', 'output_json')) {
    db.exec('ALTER TABLE agent_tasks DROP COLUMN output_json;');
  }
}
