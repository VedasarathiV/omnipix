import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initDb, getDb } from '../../db/index.js';
import { runWorkspace } from '../../lib/workspace.js';
import { createAgentRun } from '../../services/agent-runtime.js';

let dir: string;

beforeEach(() => {
  process.env.ENCRYPTION_KEY = '0'.repeat(64);
  initDb(':memory:');
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnipix-workdir-'));
  fs.writeFileSync(path.join(dir, 'hello.txt'), 'hi');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  getDb().close();
});

describe('agent run workdir', () => {
  it('resolves tools into the chosen folder', () => {
    const id = createAgentRun({ goal: 'x', workdir: dir });
    expect(runWorkspace(id)).toBe(dir);
  });

  it('keeps a private workspace when no workdir is set', () => {
    const id = createAgentRun({ goal: 'x' });
    expect(runWorkspace(id)).toContain(`run-${id}`);
  });

  it('fails loudly when the folder vanished', () => {
    const id = createAgentRun({ goal: 'x', workdir: dir });
    fs.rmSync(dir, { recursive: true, force: true });
    expect(() => runWorkspace(id)).toThrow('Run working directory is gone');
  });

  it('child runs inherit the delegation root workdir', () => {
    const parent = createAgentRun({ goal: 'x', workdir: dir });
    const child = createAgentRun({ goal: 'y', parentRunId: parent });
    expect(runWorkspace(child)).toBe(dir);
  });
});
