// Migration: agent session working directory (chat hands its open folder to
// the agent session, so runs in that session default to the same project).
// Created: 2026-11-23.
//
// DOWN: reversible (drops the column; runs fall back to explicit/private dirs).

import type { Db } from '../types.js';

function hasColumn(db: Db, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return columns.some((candidate) => candidate.name === column);
}

export function up(db: Db): void {
  if (!hasColumn(db, 'agent_sessions', 'workdir')) {
    db.exec(`
      ALTER TABLE agent_sessions ADD COLUMN workdir TEXT;
    `);
  }
}

export function down(db: Db): void {
  if (hasColumn(db, 'agent_sessions', 'workdir')) {
    db.exec(`
      ALTER TABLE agent_sessions DROP COLUMN workdir;
    `);
  }
}
