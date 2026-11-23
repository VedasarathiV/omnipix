// Migration: outbound webhooks.
//
// Operators register URLs that receive a signed POST when things happen:
// runs finishing, approvals parking, automations landing, evals completing,
// groups settling, security scans finding. The HMAC secret is encrypted at
// rest like provider keys; firing state (last status/error) lives on the row
// so the dashboard can show webhook health without a log dive.
import type { Db } from '../types.js';

export function up(db: Db): void {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS webhooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      events_json TEXT NOT NULL DEFAULT '[]',
      secret_encrypted TEXT,
      secret_iv TEXT,
      secret_auth_tag TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_status INTEGER,
      last_error TEXT,
      last_fired_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )
  `).run();
}

export function down(db: Db): void {
  db.prepare('DROP TABLE IF EXISTS webhooks').run();
}
