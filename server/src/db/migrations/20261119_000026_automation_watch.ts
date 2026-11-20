// Migration: file-watch triggers on automations.
//
// A cron schedule wakes an agent on a clock; a watch list wakes it on a file
// change. `watch_json` holds a JSON array of absolute paths (files or
// directories, watched recursively). The watcher only fires for automations
// that are enabled AND reviewed — the same review-first gate as schedules —
// and never stacks runs.
import type { Db } from '../types.js';

export function up(db: Db): void {
  const columns = db.prepare('PRAGMA table_info(automations)').all() as { name: string }[];
  if (!columns.some(c => c.name === 'watch_json')) {
    db.prepare(`ALTER TABLE automations ADD COLUMN watch_json TEXT NOT NULL DEFAULT '[]'`).run();
  }
}

export function down(db: Db): void {
  const columns = db.prepare('PRAGMA table_info(automations)').all() as { name: string }[];
  if (columns.some(c => c.name === 'watch_json')) {
    db.prepare('ALTER TABLE automations DROP COLUMN watch_json').run();
  }
}
