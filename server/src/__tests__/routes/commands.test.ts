import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

async function call(method: string, urlPath: string, body?: unknown, authed = true) {
  const server = app.listen(0, '127.0.0.1');
  if (!server.listening) await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const addr = server.address() as { port: number };
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authed && isGatedApiPath(urlPath)) headers['Authorization'] = `Bearer ${dashToken}`;
  const res = await nativeFetch(`http://127.0.0.1:${addr.port}${urlPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  server.close();
  return { status: res.status, body: data as any };
}

describe('commands routes', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omnipix-commands-'));
    process.env.OMNIPIX_CONFIG_DIR = tmpRoot;
    app = createApp();
    dashToken = mintDashboardToken();
  });

  afterEach(() => {
    delete process.env.OMNIPIX_CONFIG_DIR;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('requires dashboard auth', async () => {
    expect((await call('GET', '/api/commands', undefined, false)).status).toBe(401);
  });

  it('creates, lists, and deletes authored commands', async () => {
    const created = await call('POST', '/api/commands', {
      name: 'review-pr',
      description: 'Review a pull request',
      template: 'Review this diff: $ARGUMENTS',
    });
    expect(created.status).toBe(201);
    expect(created.body.command).toMatchObject({ name: 'review-pr', description: 'Review a pull request' });
    expect(fs.existsSync(path.join(tmpRoot, 'commands', 'review-pr.md'))).toBe(true);

    const dup = await call('POST', '/api/commands', {
      name: 'review-pr',
      description: 'Again',
      template: 'x',
    });
    expect(dup.status).toBe(409);

    const listed = await call('GET', '/api/commands');
    expect(listed.status).toBe(200);
    const names = (listed.body.commands as { name: string }[]).map(c => c.name);
    expect(names).toContain('review-pr');

    // Scoped names survive the round trip (the DELETE route spans slashes).
    const scoped = await call('POST', '/api/commands', {
      name: 'team/review-pr',
      description: 'Scoped',
      template: 'x',
    });
    expect(scoped.status).toBe(201);
    const deletedScoped = await call('DELETE', '/api/commands/team/review-pr');
    expect(deletedScoped.status).toBe(200);
    expect(deletedScoped.body).toEqual({ deleted: 'team/review-pr' });

    const deleted = await call('DELETE', '/api/commands/review-pr');
    expect(deleted.status).toBe(200);
    expect((await call('DELETE', '/api/commands/review-pr')).status).toBe(404);
    expect(fs.existsSync(path.join(tmpRoot, 'commands', 'review-pr.md'))).toBe(false);
  });

  it('rejects bad names on create and delete', async () => {
    expect((await call('POST', '/api/commands', { name: 'Nope', description: 'x', template: 'y' })).status).toBe(400);
    expect((await call('POST', '/api/commands', { name: '../evil', description: 'x', template: 'y' })).status).toBe(400);
    // (A literal /../ in the URL never reaches the route — HTTP clients
    // normalize it away — so the DELETE guard is proven with a bad segment.)
    expect((await call('DELETE', '/api/commands/Nope')).status).toBe(400);
  });
});
