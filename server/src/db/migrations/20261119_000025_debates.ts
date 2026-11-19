// Migration: consensus debates.
//
// A debate runs one prompt through N models over R rounds — every round each
// model sees the other models' previous answers and may rebut or revise —
// then a judge reads the transcript and delivers the verdict. Rounds are the
// durable artifact: replays, audits, and the dashboard transcript all read
// rounds_json, never provider logs.
import type { Db } from '../types.js';

export function up(db: Db): void {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS debates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt TEXT NOT NULL,
      models_json TEXT NOT NULL DEFAULT '[]',
      judge TEXT,
      rounds_json TEXT NOT NULL DEFAULT '[]',
      verdict_json TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      finished_at TEXT
    )
  `).run();
}

export function down(db: Db): void {
  db.prepare('DROP TABLE IF EXISTS debates').run();
}
