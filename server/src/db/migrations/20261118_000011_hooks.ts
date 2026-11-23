// Migration: deterministic lifecycle hooks (gap 5).
//
// A hook is an operator-configured shell command that runs on an agent
// lifecycle event. pre_tool hooks gate execution (nonzero exit denies the
// call); post_tool hooks observe settled calls. Hooks run with the run's
// workspace as cwd and a JSON payload in OMNIPIX_HOOK_PAYLOAD.

import type { Db } from '../types.js';

export function up(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_hooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      event TEXT NOT NULL,
      tool_filter TEXT NOT NULL DEFAULT '',
      command TEXT NOT NULL,
      timeout_ms INTEGER NOT NULL DEFAULT 30000,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_hooks_event ON agent_hooks(event, enabled);
  `);
}

export function down(db: Db): void {
  db.exec('DROP TABLE IF EXISTS agent_hooks;');
}
