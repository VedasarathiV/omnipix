import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb } from '../../db/index.js';
import { __quiesceAgentRuns } from '../../services/agent-runtime.js';
import { mintDashboardToken, isGatedApiPath } from '../helpers/auth.js';

// File commands + file agents through POST /api/agents/runs. Command and
// agent files live in a throwaway config dir wired via OMNIPIX_SKILLS_DIR
// (its parent becomes a config dir); names are unique to this file so a
// real home directory can never collide.
let app: Express;
let dashToken: string;
let root = '';
const nativeFetch = globalThis.fetch.bind(globalThis);
const savedSkillsDir = process.env.OMNIPIX_SKILLS_DIR;

async function call(method: string, path: string, body?: unknown) {
  const server = app.listen(0, '127.0.0.1');
  if (!server.listening) await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const addr = server.address() as { port: number };
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (isGatedApiPath(path)) headers['Authorization'] = `Bearer ${dashToken}`;
  const res = await nativeFetch(`http://127.0.0.1:${addr.port}${path}`, {
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
  root = mkdtempSync(join(tmpdir(), 'omnipix-m2route-'));
  mkdirSync(join(root, 'skills'), { recursive: true });
  mkdirSync(join(root, 'commands'), { recursive: true });
  mkdirSync(join(root, 'agents'), { recursive: true });
  process.env.OMNIPIX_SKILLS_DIR = join(root, 'skills');
  initDb(':memory:');
  app = createApp();
  dashToken = mintDashboardToken();
});

afterEach(async () => {
  await __quiesceAgentRuns().catch(() => undefined);
  if (root) rmSync(root, { recursive: true, force: true });
  root = '';
  if (savedSkillsDir === undefined) delete process.env.OMNIPIX_SKILLS_DIR;
  else process.env.OMNIPIX_SKILLS_DIR = savedSkillsDir;
});

describe('file commands + agents on run creation', () => {
  it('expands a leading /command into the run goal', async () => {
    writeFileSync(join(root, 'commands', 'm2echo.md'), '---\ndescription: Echo.\n---\nDo this: $ARGUMENTS\n');
    const { status, body } = await call('POST', '/api/agents/runs', { goal: '/m2echo hello world' });
    expect(status).toBe(202);
    expect(body.goal).toBe('Do this: hello world');
  });

  it('leaves unknown /names to the skill error', async () => {
    const { status, body } = await call('POST', '/api/agents/runs', { goal: '/m2nosuchcmd hello' });
    expect(status).toBe(400);
    expect(body.error.message).toMatch(/Unknown skill\(s\): m2nosuchcmd/);
  });

  it('applies a file-agent preset', async () => {
    writeFileSync(
      join(root, 'agents', 'm2reader.md'),
      '---\ndescription: Reader.\nskills: planner\ntools: read_file, grep_search\n---\n',
    );
    const { status, body } = await call('POST', '/api/agents/runs', { goal: 'read things', agent: 'm2reader' });
    expect(status).toBe(202);
    expect(body.skills).toEqual(['planner']);
    expect(body.tools).toEqual(['read_file', 'grep_search']);
  });

  it('rejects unknown agents like unknown skills', async () => {
    const { status, body } = await call('POST', '/api/agents/runs', { goal: 'x', agent: 'm2ghost' });
    expect(status).toBe(400);
    expect(body.error.message).toBe('Unknown agent: m2ghost.');
  });

  it('lets explicit fields win over presets', async () => {
    writeFileSync(
      join(root, 'agents', 'm2both.md'),
      '---\ndescription: Both.\nskills: planner\ntools: read_file\n---\n',
    );
    const { status, body } = await call('POST', '/api/agents/runs', {
      goal: 'x', agent: 'm2both', tools: ['calculator'],
    });
    expect(status).toBe(202);
    expect(body.skills).toEqual(['planner']);
    expect(body.tools).toEqual(['calculator']);
  });

  it('applies a command-named agent preset', async () => {
    writeFileSync(
      join(root, 'agents', 'm2checker.md'),
      '---\ndescription: Checker.\ntools: read_file\n---\n',
    );
    writeFileSync(
      join(root, 'commands', 'm2check.md'),
      '---\ndescription: Check.\nagent: m2checker\n---\nCheck $ARGUMENTS\n',
    );
    const { status, body } = await call('POST', '/api/agents/runs', { goal: '/m2check the code' });
    expect(status).toBe(202);
    expect(body.goal).toBe('Check the code');
    expect(body.tools).toEqual(['read_file']);
  });
});
