// Migration: reference images on agent runs (screenshots, mockups, error
// dialogs the agent sees alongside the goal).
// Created: 2026-11-23.
//
// DOWN: reversible (drops the column; runs lose their reference images).

import type { Db } from '../types.js';

function hasColumn(db: Db, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return columns.some((candidate) => candidate.name === column);
}

export function up(db: Db): void {
  if (!hasColumn(db, 'agent_runs', 'images_json')) {
    db.exec(`
      ALTER TABLE agent_runs ADD COLUMN images_json TEXT;
    `);
  }
}

export function down(db: Db): void {
  if (hasColumn(db, 'agent_runs', 'images_json')) {
    db.exec(`
      ALTER TABLE agent_runs DROP COLUMN images_json;
    `);
  }
}
