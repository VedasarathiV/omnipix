// Migration: agent run working directory (execute inside a user folder).
// Created: 2026-11-23.
//
// DOWN: reversible (drops the column; runs fall back to private workspaces).

import type { Db } from '../types.js';

function hasColumn(db: Db, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return columns.some((candidate) => candidate.name === column);
}

export function up(db: Db): void {
  // Idempotent: baseline re-runs (tests, repaired installs) must not fail
  // on a column an earlier pass already added.
  if (!hasColumn(db, 'agent_runs', 'workdir')) {
    db.exec(`
      ALTER TABLE agent_runs ADD COLUMN workdir TEXT;
    `);
  }
}

export function down(db: Db): void {
  if (hasColumn(db, 'agent_runs', 'workdir')) {
    db.exec(`
      ALTER TABLE agent_runs DROP COLUMN workdir;
    `);
  }
}
