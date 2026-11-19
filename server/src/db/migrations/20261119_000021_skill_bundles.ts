// Migration: skill bundles (orchestration #8).
//
// bundle_json names the member skills a bundle skill expands to, so one
// /name loads several skills. One level only (validated at write time);
// expansion happens in selectSkills.

import type { Db } from '../types.js';

function hasColumn(db: Db, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return columns.some((candidate) => candidate.name === column);
}

export function up(db: Db): void {
  if (!hasColumn(db, 'skills', 'bundle_json')) {
    db.exec('ALTER TABLE skills ADD COLUMN bundle_json TEXT;');
  }
}

export function down(db: Db): void {
  if (hasColumn(db, 'skills', 'bundle_json')) {
    db.exec('ALTER TABLE skills DROP COLUMN bundle_json;');
  }
}
