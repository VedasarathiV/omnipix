// Migration: folder snapshot on playground conversations (each chat remembers
// the project folder it worked in; reopening the chat restores it).
// Created: 2026-11-23.
//
// DOWN: reversible (drops the columns; chats keep transcripts, lose folders).

import type { Db } from '../types.js';

function hasColumn(db: Db, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return columns.some((candidate) => candidate.name === column);
}

const COLUMNS: Array<[string, string]> = [
  ['folder_root', 'TEXT'],
  ['folder_tree', 'TEXT'],
  ['folder_files', 'INTEGER'],
  ['folder_truncated', 'INTEGER'],
];

export function up(db: Db): void {
  for (const [column, type] of COLUMNS) {
    if (!hasColumn(db, 'playground_conversations', column)) {
      db.exec(`ALTER TABLE playground_conversations ADD COLUMN ${column} ${type};`);
    }
  }
}

export function down(db: Db): void {
  for (const [column] of COLUMNS) {
    if (hasColumn(db, 'playground_conversations', column)) {
      db.exec(`ALTER TABLE playground_conversations DROP COLUMN ${column};`);
    }
  }
}
