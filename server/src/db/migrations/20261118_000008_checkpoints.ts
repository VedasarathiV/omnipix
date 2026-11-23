// Migration: run checkpoints (gap 2).
//
// A checkpoint is a point-in-time copy of a run's workspace plus the step
// sequence at capture. Restoring rewinds FILES only — the step trace keeps
// a restore record, so the audit trail never rewrites history.

import type { Db } from '../types.js';

export function up(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS checkpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      rel_path TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_checkpoints_run ON checkpoints(run_id, id DESC);
  `);
}

export function down(db: Db): void {
  db.exec('DROP TABLE IF EXISTS checkpoints;');
}
