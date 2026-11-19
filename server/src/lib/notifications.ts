import { getDb } from '../db/index.js';

// Operator notifications (Phase 4): automation completions, parked
// approvals, and other things that need human eyes. Append-only from
// producers; the dashboard marks read.

export interface NotificationRow {
  id: number;
  kind: string;
  title: string;
  body: string;
  link: string;
  read: number;
  created_at: string;
}

export function notify(kind: string, title: string, body = '', link = ''): number {
  try {
    const row = getDb().prepare(
      'INSERT INTO notifications (kind, title, body, link) VALUES (?, ?, ?, ?) RETURNING id',
    ).get(kind.slice(0, 32), title.slice(0, 200), body.slice(0, 2000), link.slice(0, 500)) as { id: number };
    return row.id;
  } catch {
    // Notifications must never break the producer (boot paths, tight loops).
    return 0;
  }
}

export function listNotifications(unreadOnly = false, limit = 50): NotificationRow[] {
  const db = getDb();
  const capped = Math.min(200, Math.max(1, limit));
  if (unreadOnly) {
    return db.prepare('SELECT * FROM notifications WHERE read = 0 ORDER BY id DESC LIMIT ?').all(capped) as NotificationRow[];
  }
  return db.prepare('SELECT * FROM notifications ORDER BY id DESC LIMIT ?').all(capped) as NotificationRow[];
}

export function unreadCount(): number {
  try {
    return (getDb().prepare('SELECT COUNT(*) AS n FROM notifications WHERE read = 0').get() as { n: number }).n;
  } catch {
    return 0;
  }
}

export function markRead(id: number): boolean {
  return getDb().prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(id).changes > 0;
}

export function markAllRead(): number {
  const result = getDb().prepare('UPDATE notifications SET read = 1 WHERE read = 0').run();
  return Number(result.changes);
}
