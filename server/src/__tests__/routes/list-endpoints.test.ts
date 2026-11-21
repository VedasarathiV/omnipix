import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
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
const savedSkillsDir = process.env.OMNIPIX_SKILLS_DIR;

async function call(method: string, path: string, authed = true) {
  const server = app.listen(0, '127.0.0.1');
  if (!server.listening) await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const addr = server.address() as { port: number };
  const headers: Record<string, string> = {};
  if (authed && isGatedApiPath(path)) headers['Authorization'] = `Bearer ${dashToken}`;
  const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, { method, headers });
  const data = await res.json().catch(() => null);
  server.close();
  return { status: res.status, body: data as any };
}

beforeEach(() => {
  process.env.ENCRYPTION_KEY = '0'.repeat(64);
  root = mkdtempSync(join(tmpdir(), 'omnipix-list-'));
  mkdirSync(join(root, 'skills'), { recursive: true });
  mkdirSync(join(root, 'commands'), { recursive: true });
  mkdirSync(join(root, 'agents'), { recursive: true });
  process.env.OMNIPIX_SKILLS_DIR = join(root, 'skills');
  initDb(':memory:');
  app = createApp();
  dashToken = mintDashboardToken();
});

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = '';
  if (savedSkillsDir === undefined) delete process.env.OMNIPIX_SKILLS_DIR;
  else process.env.OMNIPIX_SKILLS_DIR = savedSkillsDir;
});

describe('list endpoints', () => {
  it('requires dashboard auth', async () => {
    expect((await call('GET', '/api/commands', false)).status).toBe(401);
    expect((await call('GET', '/api/agents/presets', false)).status).toBe(401);
  });

  it('lists file commands with templates', async () => {
    writeFileSync(join(root, 'commands', 'u1demo.md'), '---\ndescription: Demo.\nagent: u1ag\n---\nDo $ARGUMENTS\n');
    const { status, body } = await call('GET', '/api/commands');
    expect(status).toBe(200);
    const found = body.commands.find((c: any) => c.name === 'u1demo');
    expect(found).toMatchObject({ description: 'Demo.', agent: 'u1ag', template: 'Do $ARGUMENTS' });
  });

  it('lists file-agent presets', async () => {
    writeFileSync(join(root, 'agents', 'u1ag.md'), '---\ndescription: Demo agent.\ntools: read_file\n---\n');
    const { status, body } = await call('GET', '/api/agents/presets');
    expect(status).toBe(200);
    const found = body.presets.find((p: any) => p.name === 'u1ag');
    expect(found).toMatchObject({ description: 'Demo agent.', tools: ['read_file'] });
  });
});
