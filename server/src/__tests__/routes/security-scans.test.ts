import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb } from '../../db/index.js';
import { mintDashboardToken, isGatedApiPath } from '../helpers/auth.js';

let app: Express;
let dashToken: string;
let tmpRoot: string;
const nativeFetch = globalThis.fetch.bind(globalThis);

async function call(method: string, path: string, body?: unknown, authed = true) {
  const server = app.listen(0, '127.0.0.1');
  if (!server.listening) await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const addr = server.address() as { port: number };
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authed && isGatedApiPath(path)) headers['Authorization'] = `Bearer ${dashToken}`;
  const res = await nativeFetch(`http://127.0.0.1:${addr.port}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  server.close();
  return { status: res.status, body: data as any };
}

describe('security scan routes', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omnipix-scan-routes-'));
    process.env.OMNIPIX_WORKSPACE_ROOT = tmpRoot;
    app = createApp();
    dashToken = mintDashboardToken();
  });

  afterEach(() => {
    globalThis.fetch = nativeFetch;
    delete process.env.OMNIPIX_WORKSPACE_ROOT;
    vi.unstubAllGlobals();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('runs a scan on demand and reads it back', async () => {
    fs.mkdirSync(path.join(tmpRoot, 'run-1'), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, 'run-1', 'a.js'), 'const k = "AKIAIOSFODNN7EXAMPLE";\n');

    const empty = await call('GET', '/api/agents/scans');
    expect(empty.status).toBe(200);
    expect(empty.body.scans).toHaveLength(0);
    expect(empty.body.settings).toMatchObject({ enabled: true, schedule: '0 3 * * *' });

    const created = await call('POST', '/api/agents/scans');
    expect(created.status).toBe(201);
    expect(created.body.scan).toMatchObject({ trigger: 'manual', status: 'done', workspace_count: 1, finding_count: 1 });
    expect(created.body.findings).toHaveLength(1);
    expect(created.body.findings[0]).toMatchObject({ pattern: 'aws-key', severity: 'high', file: 'a.js', line: 1 });

    const listed = await call('GET', '/api/agents/scans');
    expect(listed.body.scans).toHaveLength(1);
    const detail = await call('GET', `/api/agents/scans/${created.body.scan.id}`);
    expect(detail.body.findings).toHaveLength(1);
  });

  it('updates scan settings', async () => {
    const updated = await call('PATCH', '/api/agents/scans-settings', { schedule: '*/30 * * * *' });
    expect(updated.status).toBe(200);
    expect(updated.body.settings.schedule).toBe('*/30 * * * *');
    const disabled = await call('PATCH', '/api/agents/scans-settings', { enabled: false });
    expect(disabled.body.settings.enabled).toBe(false);
    expect((await call('PATCH', '/api/agents/scans-settings', { schedule: 'nope' })).status).toBe(400);
  });

  it('validates scan endpoints', async () => {
    expect((await call('GET', '/api/agents/scans/99999')).status).toBe(404);
    expect((await call('GET', '/api/agents/scans/nope')).status).toBe(400);
    expect((await call('GET', '/api/agents/scans', undefined, false)).status).toBe(401);
    expect((await call('POST', '/api/agents/scans', undefined, false)).status).toBe(401);
  });
});
