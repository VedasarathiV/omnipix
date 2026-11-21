// Migration: file-managed skills (opencode-parity M1).
//
// source_path marks rows synced from SKILL.md files on disk. File-managed
// rows refresh when their file changes and delete when it disappears;
// NULL means dashboard/CLI-created and is never touched by the sync.

import type { Db } from '../types.js';

function hasColumn(db: Db, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return columns.some((candidate) => candidate.name === column);
}

export function up(db: Db): void {
  if (!hasColumn(db, 'skills', 'source_path')) {
    db.exec('ALTER TABLE skills ADD COLUMN source_path TEXT;');
  }
}

export function down(db: Db): void {
  if (hasColumn(db, 'skills', 'source_path')) {
    db.exec('ALTER TABLE skills DROP COLUMN source_path;');
  }
}
