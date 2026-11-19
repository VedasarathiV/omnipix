// Migration: ingested doc chunks (gap 8).
//
// URL ingestion turns a page into chunked text scoped to a project key.
// Agents recall chunks by keyword (recall_docs); chat @-mentions pin a doc
// into the prompt. Re-ingesting a URL replaces its chunks wholesale.

import type { Db } from '../types.js';

export function up(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS doc_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_key TEXT NOT NULL,
      source_url TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      chunk_index INTEGER NOT NULL,
      section TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_doc_chunks_project ON doc_chunks(project_key, chunk_index);
    CREATE INDEX IF NOT EXISTS idx_doc_chunks_source ON doc_chunks(project_key, source_url);
  `);
}

export function down(db: Db): void {
  db.exec('DROP TABLE IF EXISTS doc_chunks;');
}
