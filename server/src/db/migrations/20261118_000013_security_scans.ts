// Migration: scheduled security scans (gap 7).
//
// A scan greps every agent workspace for secret and risky-code patterns and
// persists its findings. The scheduler diffs each scan against the previous
// one and notifies only on NEW findings, so a standing issue nags once.

import type { Db } from '../types.js';

export function up(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS security_scans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trigger TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'done',
      workspace_count INTEGER NOT NULL DEFAULT 0,
      finding_count INTEGER NOT NULL DEFAULT 0,
      new_count INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      finished_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS security_findings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scan_id INTEGER NOT NULL REFERENCES security_scans(id) ON DELETE CASCADE,
      workspace TEXT NOT NULL,
      pattern TEXT NOT NULL,
      severity TEXT NOT NULL,
      file TEXT NOT NULL,
      line INTEGER NOT NULL,
      excerpt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_security_findings_scan ON security_findings(scan_id);
  `);
}

export function down(db: Db): void {
  db.exec(`
    DROP TABLE IF EXISTS security_findings;
    DROP TABLE IF EXISTS security_scans;
  `);
}
