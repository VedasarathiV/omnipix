import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb } from '../../db/index.js';
import { mintDashboardToken } from '../helpers/auth.js';

async function call(app: Express, method: string, path: string, token: string, body?: unknown) {
  const server = app.listen(0, '127.0.0.1');
  if (!server.listening) await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const addr = server.address() as { port: number };
  const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  server.close();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe('standalone terminal', () => {
  let app: Express;
  let token: string;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    app = createApp();
    token = mintDashboardToken();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports the default workspace cwd', async () => {
    const res = await call(app, 'GET', '/api/terminal/cwd', token);
    expect(res.status).toBe(200);
    expect(res.body.cwd).toContain('omnipix-workspaces');
  });

  it('runs a harmless command in the workspace', async () => {
    const res = await call(app, 'POST', '/api/terminal/exec', token, { command: 'echo terminal-ok' });
    expect(res.status).toBe(200);
    expect(res.body.stdout).toContain('terminal-ok');
    expect(res.body.cwd).toContain('omnipix-workspaces');
  });

  it('denies destructive shapes and bad input', async () => {
    expect((await call(app, 'POST', '/api/terminal/exec', token, { command: 'rm -rf /' })).status).toBe(400);
    expect((await call(app, 'POST', '/api/terminal/exec', token, { command: '' })).status).toBe(400);
    expect((await call(app, 'POST', '/api/terminal/exec', token, { command: 'echo x', cwd: '/nonexistent-dir-xyz' })).status).toBe(400);
    expect((await call(app, 'POST', '/api/terminal/exec', token, { command: 'echo x', cwd: '../../..' })).status).toBe(400);
  });

  it('requires dashboard auth', async () => {
    const server = app.listen(0, '127.0.0.1');
    if (!server.listening) await new Promise<void>(resolve => server.once('listening', () => resolve()));
    const addr = server.address() as { port: number };
    try {
      const res = await fetch(`http://127.0.0.1:${addr.port}/api/terminal/exec`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: 'echo x' }),
      });
      expect(res.status).toBe(401);
    } finally {
      server.close();
    }
  });
});
