// Migration: learning loop storage (orchestration #6).
//
// learning_proposals holds operator-reviewable skill and memory proposals
// distilled from finished runs (nothing applies itself). runs_fts is an FTS5
// index over run goals and answers with sync triggers, so past sessions stay
// searchable without an external engine.

import type { Db } from '../types.js';

export function up(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS learning_proposals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body_json TEXT NOT NULL,
      source_run_id INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_learning_proposals_status ON learning_proposals(status);
  `);
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS runs_fts USING fts5(
      goal, final_answer, content='agent_runs', content_rowid='id', tokenize='porter'
    );
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS runs_fts_ai AFTER INSERT ON agent_runs BEGIN
      INSERT INTO runs_fts(rowid, goal, final_answer) VALUES (new.id, new.goal, new.final_answer);
    END;
    CREATE TRIGGER IF NOT EXISTS runs_fts_au AFTER UPDATE ON agent_runs BEGIN
      INSERT INTO runs_fts(runs_fts, rowid, goal, final_answer) VALUES('delete', old.id, old.goal, old.final_answer);
      INSERT INTO runs_fts(rowid, goal, final_answer) VALUES (new.id, new.goal, new.final_answer);
    END;
    CREATE TRIGGER IF NOT EXISTS runs_fts_ad AFTER DELETE ON agent_runs BEGIN
      INSERT INTO runs_fts(runs_fts, rowid, goal, final_answer) VALUES('delete', old.id, old.goal, old.final_answer);
    END;
  `);
  // Backfill for databases created before this migration (fresh DBs insert nothing).
  db.exec(`
    INSERT INTO runs_fts(rowid, goal, final_answer)
    SELECT id, goal, final_answer FROM agent_runs WHERE id NOT IN (SELECT rowid FROM runs_fts);
  `);
}

export function down(db: Db): void {
  db.exec(`
    DROP TRIGGER IF EXISTS runs_fts_ad;
    DROP TRIGGER IF EXISTS runs_fts_au;
    DROP TRIGGER IF EXISTS runs_fts_ai;
    DROP TABLE IF EXISTS runs_fts;
    DROP TABLE IF EXISTS learning_proposals;
  `);
}
