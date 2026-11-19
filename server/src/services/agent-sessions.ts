import { getDb } from '../db/index.js';

export interface AgentSession {
  id: number;
  title: string;
  conversation_id: number | null;
  run_count: number;
  last_status: string | null;
  created_at: string;
  updated_at: string;
}

export function createSession(title: string, conversationId?: number): number {
  const db = getDb();
  if (conversationId !== undefined) {
    const convo = db.prepare('SELECT id FROM playground_conversations WHERE id = ?').get(conversationId);
    if (!convo) throw new Error(`Unknown conversation: ${conversationId}.`);
  }
  const row = db.prepare(
    'INSERT INTO agent_sessions (title, conversation_id) VALUES (?, ?) RETURNING id',
  ).get(title.slice(0, 120), conversationId ?? null) as { id: number };
  return row.id;
}

export function getSession(id: number): AgentSession | null {
  const row = getDb().prepare(
    `SELECT s.*,
       (SELECT COUNT(*) FROM agent_runs r WHERE r.session_id = s.id) AS run_count,
       (SELECT status FROM agent_runs r WHERE r.session_id = s.id ORDER BY id DESC LIMIT 1) AS last_status
     FROM agent_sessions s WHERE s.id = ?`,
  ).get(id) as AgentSession | undefined;
  return row ?? null;
}

export function listSessions(limit = 20): AgentSession[] {
  const db = getDb();
  return db.prepare(
    `SELECT s.*,
       (SELECT COUNT(*) FROM agent_runs r WHERE r.session_id = s.id) AS run_count,
       (SELECT status FROM agent_runs r WHERE r.session_id = s.id ORDER BY id DESC LIMIT 1) AS last_status
     FROM agent_sessions s ORDER BY s.updated_at DESC LIMIT ?`,
  ).all(Math.min(100, Math.max(1, limit))) as AgentSession[];
}

/** Delete a session and every run in it (steps and approvals cascade). */
export function deleteSession(id: number): boolean {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM agent_sessions WHERE id = ?').get(id);
  if (!existing) return false;
  db.prepare('DELETE FROM agent_runs WHERE session_id = ?').run(id);
  db.prepare('DELETE FROM agent_sessions WHERE id = ?').run(id);
  return true;
}

export function touchSession(id: number): void {
  getDb().prepare(
    "UPDATE agent_sessions SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
  ).run(id);
}
