import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb } from '../../db/index.js';
import { mintDashboardToken, isGatedApiPath } from '../helpers/auth.js';

let app: Express;
let dashToken: string;
let root = '';

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

beforeEach(() => {
  process.env.ENCRYPTION_KEY = '0'.repeat(64);
  root = mkdtempSync(join(tmpdir(), 'omnipix-fs-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 1;\n');
  writeFileSync(join(root, 'README.md'), '# demo\n');
  writeFileSync(join(root, 'blob.bin'), Buffer.from([0x00, 0x01, 0x02]));
  initDb(':memory:');
  app = createApp();
  dashToken = mintDashboardToken();
});

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = '';
});

describe('folder fs api', () => {
  it('requires dashboard auth', async () => {
    expect((await call('GET', `/api/fs/list?root=${encodeURIComponent(root)}`, undefined, false)).status).toBe(401);
  });

  it('lists nested files as flat relative paths', async () => {
    const res = await call('GET', `/api/fs/list?root=${encodeURIComponent(root)}`);
    expect(res.status).toBe(200);
    const paths = (res.body.entries as Array<{ path: string }>).map(e => e.path).sort();
    expect(paths).toContain('src/a.ts');
    expect(paths).toContain('README.md');
    expect(paths).not.toContain('src');
    expect(res.body.truncated).toBe(false);
  });

  it('rejects missing roots and non-directories', async () => {
    expect((await call('GET', '/api/fs/list?root=/no/such/dir')).status).toBe(400);
    const file = await call('GET', `/api/fs/list?root=${encodeURIComponent(join(root, 'README.md'))}`);
    expect(file.status).toBe(400);
  });

  it('reads text, flags binary, 404s missing files', async () => {
    const text = await call('GET', `/api/fs/read?root=${encodeURIComponent(root)}&path=${encodeURIComponent('src/a.ts')}`);
    expect(text.status).toBe(200);
    expect(text.body).toMatchObject({ content: 'export const a = 1;\n', binary: false });
    const bin = await call('GET', `/api/fs/read?root=${encodeURIComponent(root)}&path=${encodeURIComponent('blob.bin')}`);
    expect(bin.body).toMatchObject({ binary: true });
    expect((await call('GET', `/api/fs/read?root=${encodeURIComponent(root)}&path=${encodeURIComponent('nope.ts')}`)).status).toBe(404);
  });

  it('greps file contents under the root', async () => {
    const res = await call('GET', `/api/fs/grep?root=${encodeURIComponent(root)}&q=${encodeURIComponent('export const a')}`);
    expect(res.status).toBe(200);
    expect(res.body.hits).toMatchObject([{ path: 'src/a.ts', line: 1 }]);
    expect(res.body.hits[0].text).toContain('export const a');
    const empty = await call('GET', `/api/fs/grep?root=${encodeURIComponent(root)}&q=${encodeURIComponent('zzz-no-match')}`);
    expect(empty.status).toBe(200);
    expect(empty.body.hits).toEqual([]);
    expect((await call('GET', `/api/fs/grep?root=${encodeURIComponent(root)}&q=`)).status).toBe(400);
    expect((await call('GET', `/api/fs/grep?root=/no/such/dir&q=x`)).status).toBe(400);
  });

  it('jails escapes, absolute paths, and symlink exits', async () => {
    const esc = await call('GET', `/api/fs/read?root=${encodeURIComponent(root)}&path=${encodeURIComponent('../outside.ts')}`);
    expect(esc.status).toBe(400);
    const abs = await call('GET', `/api/fs/read?root=${encodeURIComponent(root)}&path=${encodeURIComponent('/etc/hosts')}`);
    expect(abs.status).toBe(400);
    const outside = join(tmpdir(), `omnipix-fs-outside-${Date.now()}`);
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'secret.txt'), 'shh');
    try {
      symlinkSync(join(outside, 'secret.txt'), join(root, 'link.txt'));
      const via = await call('GET', `/api/fs/read?root=${encodeURIComponent(root)}&path=${encodeURIComponent('link.txt')}`);
      expect(via.status).toBe(400);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('writes round-trip inside the root and refuse outside it', async () => {
    const saved = await call('PUT', '/api/fs/write', { root, path: 'src/b.ts', content: 'export const b = 2;\n' });
    expect(saved.status).toBe(200);
    const reread = await call('GET', `/api/fs/read?root=${encodeURIComponent(root)}&path=${encodeURIComponent('src/b.ts')}`);
    expect(reread.body).toMatchObject({ content: 'export const b = 2;\n' });
    const esc = await call('PUT', '/api/fs/write', { root, path: '../evil.ts', content: 'x' });
    expect(esc.status).toBe(400);
    const big = await call('PUT', '/api/fs/write', { root, path: 'big.ts', content: 'x'.repeat(1024 * 1024 + 1) });
    expect(big.status).toBe(400);
  });
});
