// Migration: persistent approval rules (permission memory).
//
// Operators can pin a tool to always-allow or always-deny so trust
// compounds instead of re-asking forever. Rules apply to future calls;
// pending approvals already in the inbox are unaffected.
import type { Db } from '../types.js';

export function up(db: Db): void {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS approval_rules (
      tool TEXT PRIMARY KEY,
      decision TEXT NOT NULL CHECK (decision IN ('allow', 'deny')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )
  `).run();
}

export function down(db: Db): void {
  db.prepare('DROP TABLE IF EXISTS approval_rules').run();
}
