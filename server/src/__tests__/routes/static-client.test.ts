import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../../app.js';
import { initDb } from '../../db/index.js';

// CLIENT_DIST relocates the built dashboard for embedders (the desktop app
// ships client/dist in extraResources, out of reach of the default
// __dirname-relative path).
describe('CLIENT_DIST override', () => {
  let tmpDir: string;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnipix-client-dist-'));
    fs.writeFileSync(path.join(tmpDir, 'index.html'), '<!doctype html><title>custom-dist</title>');
  });

  afterAll(() => {
    delete process.env.CLIENT_DIST;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('serves the SPA from the overridden directory', async () => {
    process.env.CLIENT_DIST = tmpDir;
    const app = createApp();
    const server = app.listen(0, '127.0.0.1');
    if (!server.listening) await new Promise<void>(resolve => server.once('listening', () => resolve()));
    const port = (server.address() as any).port;

    const res = await fetch(`http://127.0.0.1:${port}/`);
    const html = await res.text();
    server.close();

    expect(res.status).toBe(200);
    expect(html).toContain('custom-dist');
  });

  it('answers unknown API paths with JSON, not HTML', async () => {
    process.env.CLIENT_DIST = tmpDir;
    const app = createApp();
    const server = app.listen(0, '127.0.0.1');
    if (!server.listening) await new Promise<void>(resolve => server.once('listening', () => resolve()));
    const port = (server.address() as any).port;

    for (const p of ['/api/nope', '/v1/nope', '/v1beta/nope']) {
      const res = await fetch(`http://127.0.0.1:${port}${p}`);
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toContain('application/json');
      const body = await res.json() as { error: { message: string; type: string } };
      expect(body.error.type).toBe('not_found');
      expect(body.error.message).toContain(p);
    }
    // Non-API unknowns still get the SPA shell.
    const spa = await fetch(`http://127.0.0.1:${port}/some/deep/link`);
    expect(spa.status).toBe(200);
    expect(await spa.text()).toContain('custom-dist');
    server.close();
  });
});
