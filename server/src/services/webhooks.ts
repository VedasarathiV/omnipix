import crypto from 'crypto';
import { getDb } from '../db/index.js';
import type { Db } from '../db/types.js';
import { decrypt, encrypt } from '../lib/crypto.js';

/**
 * webhooks — signed outbound POSTs on lifecycle events.
 *
 * Operators register a URL plus the events it wants; producers call
 * emitWebhook() and move on. Delivery is fire-and-forget with a 10s timeout:
 * a slow receiver must never stall a run, a tick, or a request. Per-hook
 * firing state (last HTTP status / error / time) lands on the row so the
 * dashboard can show health without a log dive.
 *
 * URLs are trusted operator config, not agent input — loopback and LAN hosts
 * are allowed (local automation is the point of a local-first app), so the
 * SSRF guard does NOT apply here. Only http(s) URLs are accepted.
 */

export const WEBHOOK_EVENTS = [
  'run.finished',
  'approval.created',
  'automation.finished',
  'eval.finished',
  'group.finished',
  'security.scan',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

const FIRE_TIMEOUT_MS = 10_000;

export interface WebhookRow {
  id: number;
  name: string;
  url: string;
  events: string[];
  hasSecret: boolean;
  enabled: number;
  last_status: number | null;
  last_error: string | null;
  last_fired_at: string | null;
  created_at: string;
}

interface StoredWebhook {
  id: number;
  name: string;
  url: string;
  events_json: string;
  secret_encrypted: string | null;
  secret_iv: string | null;
  secret_auth_tag: string | null;
  enabled: number;
  last_status: number | null;
  last_error: string | null;
  last_fired_at: string | null;
  created_at: string;
}

export function validateWebhookUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'not a valid URL';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'only http(s) URLs are allowed';
  return null;
}

function toRow(stored: StoredWebhook): WebhookRow {
  let events: string[] = [];
  try {
    const parsed: unknown = JSON.parse(stored.events_json);
    if (Array.isArray(parsed)) events = parsed.filter((e): e is string => typeof e === 'string');
  } catch {
    // Corrupt events list matches nothing rather than everything.
  }
  return {
    id: stored.id,
    name: stored.name,
    url: stored.url,
    events,
    hasSecret: stored.secret_encrypted != null,
    enabled: stored.enabled,
    last_status: stored.last_status,
    last_error: stored.last_error,
    last_fired_at: stored.last_fired_at,
    created_at: stored.created_at,
  };
}

export function listWebhooks(db: Db = getDb()): WebhookRow[] {
  return (db.prepare('SELECT * FROM webhooks ORDER BY id').all() as StoredWebhook[]).map(toRow);
}

export function createWebhook(
  db: Db,
  input: { name: string; url: string; events: string[]; secret?: string; enabled?: boolean },
): WebhookRow {
  const urlError = validateWebhookUrl(input.url);
  if (urlError) throw new Error(`Invalid URL: ${urlError}`);
  const unknown = input.events.filter((e) => e !== '*' && !(WEBHOOK_EVENTS as readonly string[]).includes(e));
  if (unknown.length) throw new Error(`Unknown event(s): ${unknown.join(', ')}. Known: ${WEBHOOK_EVENTS.join(', ')}`);
  let sealed: { encrypted: string; iv: string; authTag: string } | null = null;
  if (input.secret) sealed = encrypt(input.secret);
  const row = db.prepare(
    `INSERT INTO webhooks (name, url, events_json, secret_encrypted, secret_iv, secret_auth_tag, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
  ).get(
    input.name, input.url, JSON.stringify(input.events),
    sealed?.encrypted ?? null, sealed?.iv ?? null, sealed?.authTag ?? null,
    input.enabled === false ? 0 : 1,
  ) as StoredWebhook;
  return toRow(row);
}

export function getWebhook(db: Db, id: number): WebhookRow | null {
  const row = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id) as StoredWebhook | undefined;
  return row ? toRow(row) : null;
}

export function updateWebhook(
  db: Db,
  id: number,
  patch: { name?: string; url?: string; events?: string[]; secret?: string; enabled?: boolean },
): WebhookRow | null {
  const existing = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id) as StoredWebhook | undefined;
  if (!existing) return null;
  const name = patch.name ?? existing.name;
  const url = patch.url ?? existing.url;
  const events = patch.events ?? JSON.parse(existing.events_json) as string[];
  const urlError = validateWebhookUrl(url);
  if (urlError) throw new Error(`Invalid URL: ${urlError}`);
  const unknown = events.filter((e) => e !== '*' && !(WEBHOOK_EVENTS as readonly string[]).includes(e));
  if (unknown.length) throw new Error(`Unknown event(s): ${unknown.join(', ')}. Known: ${WEBHOOK_EVENTS.join(', ')}`);
  // Secret: omitted keeps, non-empty replaces, empty string clears.
  let sealed = {
    encrypted: existing.secret_encrypted,
    iv: existing.secret_iv,
    authTag: existing.secret_auth_tag,
  };
  if (patch.secret !== undefined) {
    if (patch.secret) {
      const fresh = encrypt(patch.secret);
      sealed = { encrypted: fresh.encrypted, iv: fresh.iv, authTag: fresh.authTag };
    } else {
      sealed = { encrypted: null, iv: null, authTag: null };
    }
  }
  const row = db.prepare(
    `UPDATE webhooks SET name = ?, url = ?, events_json = ?,
       secret_encrypted = ?, secret_iv = ?, secret_auth_tag = ?,
       enabled = ? WHERE id = ? RETURNING *`,
  ).get(
    name, url, JSON.stringify(events),
    sealed.encrypted, sealed.iv, sealed.authTag,
    patch.enabled === undefined ? existing.enabled : (patch.enabled ? 1 : 0),
    id,
  ) as StoredWebhook;
  return toRow(row);
}

export function deleteWebhook(db: Db, id: number): boolean {
  return db.prepare('DELETE FROM webhooks WHERE id = ?').run(id).changes > 0;
}

function signBody(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

async function fireOne(hook: StoredWebhook, event: WebhookEvent, payload: Record<string, unknown>): Promise<void> {
  const db = getDb();
  const body = JSON.stringify({ event, firedAt: new Date().toISOString(), data: payload });
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-omnipix-event': event,
  };
  if (hook.secret_encrypted && hook.secret_iv && hook.secret_auth_tag) {
    try {
      headers['x-omnipix-signature'] = signBody(body, decrypt(hook.secret_encrypted, hook.secret_iv, hook.secret_auth_tag));
    } catch {
      db.prepare("UPDATE webhooks SET last_status = NULL, last_error = ?, last_fired_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
        .run('cannot decrypt webhook secret under this ENCRYPTION_KEY', hook.id);
      return;
    }
  }
  try {
    const res = await fetch(hook.url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(FIRE_TIMEOUT_MS),
    });
    // Drain so keep-alive sockets recycle; a huge error page is capped.
    await res.arrayBuffer().catch(() => null);
    db.prepare("UPDATE webhooks SET last_status = ?, last_error = ?, last_fired_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
      .run(res.status, res.ok ? null : `HTTP ${res.status}`, hook.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.prepare("UPDATE webhooks SET last_status = NULL, last_error = ?, last_fired_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
      .run(message.slice(0, 300), hook.id);
  }
}

/**
 * Fire one hook by id regardless of its event filter (the dashboard's
 * "send test" button). Returns false for an unknown hook. Never throws.
 */
export function fireWebhookTest(id: number): boolean {
  let hook: StoredWebhook | undefined;
  try {
    hook = getDb().prepare('SELECT * FROM webhooks WHERE id = ?').get(id) as StoredWebhook | undefined;
  } catch {
    return false;
  }
  if (!hook) return false;
  void fireOne(hook, 'run.finished', { test: true, webhookId: id, note: 'test delivery' }).catch(() => {
    // fireOne records its own failures; this guards the guard.
  });
  return true;
}

/**
 * Fan out one event to every enabled matching hook. Never throws, never
 * awaits delivery — producers call it and move on. `*` in a hook's events
 * subscribes to everything.
 */
export function emitWebhook(event: WebhookEvent, payload: Record<string, unknown>): void {
  let hooks: StoredWebhook[];
  try {
    hooks = getDb().prepare('SELECT * FROM webhooks WHERE enabled = 1').all() as StoredWebhook[];
  } catch {
    return;
  }
  for (const hook of hooks) {
    let events: string[] = [];
    try {
      const parsed: unknown = JSON.parse(hook.events_json);
      if (Array.isArray(parsed)) events = parsed.filter((e): e is string => typeof e === 'string');
    } catch {
      continue;
    }
    if (!events.includes(event) && !events.includes('*')) continue;
    void fireOne(hook, event, payload).catch(() => {
      // fireOne records its own failures; this guards the guard.
    });
  }
}
