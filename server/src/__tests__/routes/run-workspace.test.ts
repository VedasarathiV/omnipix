import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb } from '../../db/index.js';
import { runWorkspace } from '../../lib/workspace.js';
import { createAgentRun } from '../../services/agent-runtime.js';
import { createCheckpoint } from '../../services/checkpoints.js';
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

describe('run workspace views', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    app = createApp();
    dashToken = mintDashboardToken();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omnipix-run-workspace-'));
    process.env.OMNIPIX_WORKSPACE_ROOT = tmpRoot;
  });

  afterEach(() => {
    delete process.env.OMNIPIX_WORKSPACE_ROOT;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function seedRun(): number {
    const id = createAgentRun({ goal: 'test', model: 'auto' });
    const ws = runWorkspace(id);
    fs.mkdirSync(path.join(ws, 'src'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'src', 'a.ts'), 'line1\nline2\nline3\n');
    fs.writeFileSync(path.join(ws, 'README.md'), '# hi\n');
    return id;
  }

  it('requires dashboard auth', async () => {
    expect((await call('GET', '/api/agents/runs/1/files', undefined, false)).status).toBe(401);
  });

  it('lists the workspace tree and reads file content', async () => {
    const id = seedRun();
    const listed = await call('GET', `/api/agents/runs/${id}/files`);
    expect(listed.status).toBe(200);
    const paths = listed.body.files.map((f: { path: string }) => f.path);
    expect(paths).toContain('src');
    expect(paths).toContain('src/a.ts');
    expect(paths).toContain('README.md');
    expect(listed.body.files.find((f: { path: string }) => f.path === 'src').kind).toBe('dir');

    const content = await call('GET', `/api/agents/runs/${id}/files/content?path=${encodeURIComponent('src/a.ts')}`);
    expect(content.status).toBe(200);
    expect(content.body).toMatchObject({ path: 'src/a.ts', truncated: false, binary: false });
    expect(content.body.content).toContain('line2');

    expect((await call('GET', `/api/agents/runs/${id}/files/content?path=${encodeURIComponent('../escape')}`)).status).toBe(400);
    expect((await call('GET', `/api/agents/runs/${id}/files/content?path=${encodeURIComponent('nope.ts')}`)).status).toBe(404);
    expect((await call('GET', '/api/agents/runs/99999/files')).status).toBe(404);
  });

  it('diffs the workspace against empty and against a checkpoint', async () => {
    const id = seedRun();
    // Against the empty tree: everything the run created.
    const full = await call('GET', `/api/agents/runs/${id}/diff`);
    expect(full.status).toBe(200);
    expect(full.body.against).toBeNull();
    expect(full.body.files.map((f: { path: string }) => f.path).sort()).toEqual(['README.md', 'src/a.ts']);
    expect(full.body.files.every((f: { status: string }) => f.status === 'A')).toBe(true);

    // Snapshot, mutate, diff: one modified file with real hunks.
    const checkpointId = createCheckpoint(id, 'before edit', 0);
    const ws = runWorkspace(id);
    fs.writeFileSync(path.join(ws, 'src', 'a.ts'), 'line1\nline2 changed\nline3\nline4\n');
    fs.rmSync(path.join(ws, 'README.md'));
    fs.writeFileSync(path.join(ws, 'new.txt'), 'hello\n');

    const diff = await call('GET', `/api/agents/runs/${id}/diff?against=${checkpointId}`);
    expect(diff.status).toBe(200);
    expect(diff.body.against).toMatchObject({ checkpointId });
    const byPath = Object.fromEntries(diff.body.files.map((f: { path: string }) => [f.path, f]));
    expect(byPath['src/a.ts'].status).toBe('M');
    expect(byPath['src/a.ts'].added).toBe(2);
    expect(byPath['src/a.ts'].removed).toBe(1);
    expect(byPath['src/a.ts'].hunks.length).toBeGreaterThan(0);
    expect(byPath['src/a.ts'].hunks[0].header).toMatch(/^@@ -\d+,\d+ \+\d+,\d+ @@$/);
    expect(byPath['README.md'].status).toBe('D');
    expect(byPath['new.txt'].status).toBe('A');

    expect((await call('GET', `/api/agents/runs/${id}/diff?against=99999`)).status).toBe(404);
    expect((await call('GET', `/api/agents/runs/${id}/diff?against=nope`)).status).toBe(400);
  });

  it('reverts one file to its checkpoint snapshot', async () => {
    const id = seedRun();
    const checkpointId = createCheckpoint(id, 'before edit', 0);
    const ws = runWorkspace(id);
    fs.writeFileSync(path.join(ws, 'src', 'a.ts'), 'changed\n');
    fs.writeFileSync(path.join(ws, 'added.txt'), 'new\n');

    const reverted = await call('POST', `/api/agents/runs/${id}/files/revert`, { path: 'src/a.ts' });
    expect(reverted.status).toBe(200);
    expect(reverted.body).toMatchObject({ checkpointId, restored: true });
    expect(fs.readFileSync(path.join(ws, 'src', 'a.ts'), 'utf8')).toContain('line1');

    const removed = await call('POST', `/api/agents/runs/${id}/files/revert`, { path: 'added.txt' });
    expect(removed.status).toBe(200);
    expect(removed.body.restored).toBe(false);
    expect(fs.existsSync(path.join(ws, 'added.txt'))).toBe(false);

    expect((await call('POST', `/api/agents/runs/${id}/files/revert`, { path: '../x' })).status).toBe(400);
    expect((await call('POST', '/api/agents/runs/99999/files/revert', { path: 'a.ts' })).status).toBe(404);
  });

  it('reports git status and commits on repo workspaces', async () => {
    const id = seedRun();
    const ws = runWorkspace(id);
    const plain = await call('GET', `/api/agents/runs/${id}/git/status`);
    expect(plain.body).toMatchObject({ isRepo: false });

    const { execFileSync } = await import('node:child_process');
    execFileSync('git', ['init'], { cwd: ws });
    execFileSync('git', ['config', 'user.email', 'test@test.test'], { cwd: ws });
    execFileSync('git', ['config', 'user.name', 'test'], { cwd: ws });
    execFileSync('git', ['add', '-A'], { cwd: ws });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: ws });
    fs.writeFileSync(path.join(ws, 'src', 'a.ts'), 'dirty\n');

    const status = await call('GET', `/api/agents/runs/${id}/git/status`);
    expect(status.body.isRepo).toBe(true);
    expect(status.body.files).toContainEqual({ path: 'src/a.ts', status: 'M' });

    const branch = await call('POST', `/api/agents/runs/${id}/git/branch`, { name: 'feat/x' });
    expect(branch.status).toBe(201);
    expect((await call('POST', `/api/agents/runs/${id}/git/branch`, { name: 'bad name!' })).status).toBe(400);

    const commit = await call('POST', `/api/agents/runs/${id}/git/commit`, { message: 'dirty work' });
    expect(commit.status).toBe(200);
    expect(typeof commit.body.sha).toBe('string');
    const clean = await call('GET', `/api/agents/runs/${id}/git/status`);
    expect(clean.body.files).toHaveLength(0);
  });
});
