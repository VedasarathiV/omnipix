// Migration: semantic cache columns on response_cache.
//
// The exact-match cache keys the whole request; the semantic tier needs the
// two halves separately: `semantic_bucket` (model + sampling params, so a
// near-duplicate prompt never collides across different params) and
// `prompt_text` (normalized prompt text for similarity scoring). Old rows
// have NULLs and simply never match semantically until re-stored.

import type { Db } from '../types.js';

function hasColumn(db: Db, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return columns.some((candidate) => candidate.name === column);
}

export function up(db: Db): void {
  if (!hasColumn(db, 'response_cache', 'semantic_bucket')) {
    db.prepare('ALTER TABLE response_cache ADD COLUMN semantic_bucket TEXT').run();
  }
  if (!hasColumn(db, 'response_cache', 'prompt_text')) {
    db.prepare('ALTER TABLE response_cache ADD COLUMN prompt_text TEXT').run();
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_response_cache_semantic ON response_cache(semantic_bucket);');
}

export function down(db: Db): void {
  db.exec('DROP INDEX IF EXISTS idx_response_cache_semantic;');
  if (hasColumn(db, 'response_cache', 'prompt_text')) {
    db.prepare('ALTER TABLE response_cache DROP COLUMN prompt_text').run();
  }
  if (hasColumn(db, 'response_cache', 'semantic_bucket')) {
    db.prepare('ALTER TABLE response_cache DROP COLUMN semantic_bucket').run();
  }
}
