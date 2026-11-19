// Migration: multi-agent run groups (Phase 3).
//
// A group is one goal executed by a team: the orchestrator schedules tasks
// (a DAG with dependencies) across roles, each task running its own agent
// loop. The blackboard is shared scratch state; file locks keep two tasks
// from editing the same path concurrently.

import type { Db } from '../types.js';

export function up(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      goal TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      budget_tokens INTEGER,
      session_id INTEGER REFERENCES agent_sessions(id) ON DELETE SET NULL,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      finished_at TEXT
    );
    CREATE TABLE IF NOT EXISTS agent_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL REFERENCES agent_groups(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'coder',
      goal TEXT NOT NULL,
      tools_json TEXT NOT NULL DEFAULT '[]',
      depends_on_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending',
      run_id INTEGER REFERENCES agent_runs(id) ON DELETE SET NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 2,
      result_summary TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_agent_tasks_group ON agent_tasks(group_id, id);
    CREATE TABLE IF NOT EXISTS blackboard (
      group_id INTEGER NOT NULL REFERENCES agent_groups(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value_json TEXT NOT NULL DEFAULT '{}',
      writer_task_id INTEGER,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (group_id, key)
    );
    CREATE TABLE IF NOT EXISTS file_locks (
      group_id INTEGER NOT NULL REFERENCES agent_groups(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      task_id INTEGER NOT NULL,
      acquired_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (group_id, path)
    );
  `);
}

export function down(db: Db): void {
  db.exec(`
    DROP TABLE IF EXISTS file_locks;
    DROP TABLE IF EXISTS blackboard;
    DROP TABLE IF EXISTS agent_tasks;
    DROP TABLE IF EXISTS agent_groups;
  `);
}
