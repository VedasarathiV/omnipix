// Migration: assistant memory, automations, and notifications (Phase 4).
//
// memories: cross-run user/project memory with importance + use tracking
// for decay scoring. Values are PII-redacted at write time.
// automations: scheduled agent goals (cron). Recurring fire requires a
// reviewed manual run first — see services/automations.ts.
// notifications: operator inbox for automation completions and approvals.
// agent_runs.project_key scopes runs (and memory injection) to a project.

import type { Db } from '../types.js';

export function up(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL DEFAULT 'user',
      project_key TEXT NOT NULL DEFAULT '',
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      importance REAL NOT NULL DEFAULT 0.5,
      source TEXT NOT NULL DEFAULT 'user',
      run_id INTEGER REFERENCES agent_runs(id) ON DELETE SET NULL,
      use_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      last_used_at TEXT,
      UNIQUE (scope, project_key, key)
    );
    CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope, project_key);
    CREATE TABLE IF NOT EXISTS automations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      goal TEXT NOT NULL,
      schedule TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT 'auto',
      enabled INTEGER NOT NULL DEFAULT 1,
      reviewed INTEGER NOT NULL DEFAULT 0,
      last_run_id INTEGER REFERENCES agent_runs(id) ON DELETE SET NULL,
      last_status TEXT,
      last_run_at TEXT,
      next_run_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      link TEXT NOT NULL DEFAULT '',
      read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(read, id DESC);
  `);

  const columns = db.prepare('PRAGMA table_info(agent_runs)').all() as { name: string }[];
  if (!columns.some(column => column.name === 'project_key')) {
    db.prepare("ALTER TABLE agent_runs ADD COLUMN project_key TEXT NOT NULL DEFAULT ''").run();
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_agent_runs_project ON agent_runs(project_key, id);');
}

export function down(db: Db): void {
  db.exec('DROP INDEX IF EXISTS idx_agent_runs_project;');
  const columns = db.prepare('PRAGMA table_info(agent_runs)').all() as { name: string }[];
  if (columns.some(column => column.name === 'project_key')) {
    db.prepare('ALTER TABLE agent_runs DROP COLUMN project_key').run();
  }
  db.exec(`
    DROP TABLE IF EXISTS notifications;
    DROP TABLE IF EXISTS automations;
    DROP TABLE IF EXISTS memories;
  `);
}
