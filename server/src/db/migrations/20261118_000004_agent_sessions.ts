// Migration: agent sessions + approvals inbox.
//
// Sessions unify a conversation and its agent runs so work continues across
// surfaces: every run belongs to a session (auto-created from the goal when
// the caller passes none), and a session can link the playground conversation
// it grew out of. Approvals are the policy tier the v1 tools were waiting
// for: every tool call is evaluated (auto/pending/deny), pending calls park
// the run in `awaiting_approval`, and a decide call resumes or kills it.
// Diffs attached to file-writing approvals (Phase 1) render in the inbox.

import type { Db } from '../types.js';

export function up(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT '',
      conversation_id INTEGER REFERENCES playground_conversations(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_sessions_updated ON agent_sessions(updated_at DESC);
  `);

  const columns = db.prepare('PRAGMA table_info(agent_runs)').all() as { name: string }[];
  if (!columns.some(column => column.name === 'session_id')) {
    db.prepare('ALTER TABLE agent_runs ADD COLUMN session_id INTEGER REFERENCES agent_sessions(id) ON DELETE SET NULL').run();
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_agent_runs_session ON agent_runs(session_id, id);');

  // Backfill: each pre-existing run gets its own session titled from the goal,
  // so every historical run is continuable like a new one.
  const orphans = db.prepare('SELECT id, goal FROM agent_runs WHERE session_id IS NULL').all() as { id: number; goal: string }[];
  if (orphans.length > 0) {
    const makeSession = db.prepare('INSERT INTO agent_sessions (title) VALUES (?) RETURNING id');
    const attach = db.prepare('UPDATE agent_runs SET session_id = ? WHERE id = ?');
    for (const orphan of orphans) {
      const session = makeSession.get(orphan.goal.slice(0, 120)) as { id: number };
      attach.run(session.id, orphan.id);
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      tool TEXT NOT NULL,
      args_json TEXT NOT NULL DEFAULT '{}',
      risk TEXT NOT NULL DEFAULT 'read',
      summary TEXT NOT NULL DEFAULT '',
      diff_text TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      decided_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_approvals_run ON approvals(run_id, seq);
    CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status, id DESC);
  `);
}

export function down(db: Db): void {
  db.exec('DROP TABLE IF EXISTS approvals;');
  // The index references the column: drop it before the column goes.
  db.exec('DROP INDEX IF EXISTS idx_agent_runs_session;');
  const columns = db.prepare('PRAGMA table_info(agent_runs)').all() as { name: string }[];
  if (columns.some(column => column.name === 'session_id')) {
    db.prepare('ALTER TABLE agent_runs DROP COLUMN session_id').run();
  }
  db.exec('DROP TABLE IF EXISTS agent_sessions;');
}
