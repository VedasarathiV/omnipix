import { beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb, getDb } from '../../db/index.js';
import { mintDashboardToken, isGatedApiPath } from '../helpers/auth.js';
import { redactFreeText } from '../../services/diagnostics.js';

let app: Express;
let dashToken: string;

async function call(method: string, path: string, body?: unknown, authed = true) {
  const server = app.listen(0, '127.0.0.1');
  if (!server.listening) await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const addr = server.address() as { port: number };
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authed && isGatedApiPath(path)) headers['Authorization'] = `Bearer ${dashToken}`;
  const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  server.close();
  return { status: res.status, body: data as any };
}

describe('diagnostics bundle', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    app = createApp();
    dashToken = mintDashboardToken();
  });

  it('requires dashboard auth', async () => {
    expect((await call('GET', '/api/diagnostics/bundle', undefined, false)).status).toBe(401);
  });

  it('returns counts, versions, and a log tail', async () => {
    const { status, body } = await call('GET', '/api/diagnostics/bundle');
    expect(status).toBe(200);
    expect(typeof body.generatedAt).toBe('string');
    expect(typeof body.runtime.node).toBe('string');
    expect(body.database.migrations).toBeGreaterThan(0);
    expect(typeof body.database.latestMigration).toBe('string');
    expect(body.database.tables.models).toBeGreaterThan(0);
    expect(body.models.total).toBe(body.database.tables.models);
    expect(body.skills.total).toBeGreaterThan(0);
    expect(Array.isArray(body.logs)).toBe(true);
  });

  it('never leaks key material or tokens', async () => {
    const { body } = await call('GET', '/api/diagnostics/bundle');
    const text = JSON.stringify(body);
    expect(text).not.toContain('unified_api_key');
    expect(text).not.toContain('premium_license_key');
    expect(text).not.toContain('encrypted_key');
    expect(text).not.toContain('env_encrypted');
    // The allowlisted settings carry no secret-bearing keys.
    for (const key of Object.keys(body.settings)) {
      expect(key).not.toMatch(/api[_-]?key|license[_-]?key|secret|password|bearer/i);
    }
  });

  it('redacts token-shaped strings in free text', () => {
    expect(redactFreeText('key sk-abcdefgh12345678 failed')).toBe('key [redacted] failed');
    expect(redactFreeText('Bearer abcdefghij1234567890')).toBe('Bearer [redacted]');
    expect(redactFreeText('plain error, HTTP 429')).toBe('plain error, HTTP 429');
    expect(redactFreeText(`cipher ${'a'.repeat(40)} here`)).toBe('cipher [redacted] here');
  });

  it('reflects live state (runs, approvals, keys)', async () => {
    const db = getDb();
    db.prepare("INSERT INTO agent_sessions (id, title) VALUES (1, 's')").run();
    db.prepare(
      "INSERT INTO agent_runs (goal, model, status, session_id) VALUES ('g', 'auto', 'running', 1)",
    ).run();
    db.prepare(
      "INSERT INTO approvals (run_id, seq, tool, args_json, risk, status) VALUES (1, 0, 'shell_exec', '{}', 'high', 'pending')",
    ).run();
    const { body } = await call('GET', '/api/diagnostics/bundle');
    expect(body.agents.runsByStatus.running).toBe(1);
    expect(body.agents.approvalsPending).toBe(1);
  });
});
