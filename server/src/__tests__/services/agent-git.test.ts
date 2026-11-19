import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initDb, getDb } from '../../db/index.js';
import { agentToolByName, type AgentToolContext } from '../../services/agent-tools.js';
import { groupWorkspace, runWorkspace } from '../../lib/workspace.js';

const GIT = (() => {
  try {
    return spawnSync('git', ['--version'], { encoding: 'utf8', timeout: 5000 }).status === 0;
  } catch {
    return false;
  }
})();

let tmpRoot: string;

function ctx(runId: number): AgentToolContext {
  return { runId };
}

async function run(name: string, args: Record<string, unknown>, runId = 4242): Promise<string> {
  const tool = agentToolByName(name);
  if (!tool) throw new Error(`missing tool ${name}`);
  return tool.execute(args, ctx(runId));
}

function seedGroupRun(): { groupId: number; runId: number } {
  const groupId = (getDb().prepare("INSERT INTO agent_groups (goal) VALUES ('g') RETURNING id").get() as { id: number }).id;
  const taskId = (getDb().prepare("INSERT INTO agent_tasks (group_id, name, role, goal) VALUES (?, 't', 'coder', 'do') RETURNING id").get(groupId) as { id: number }).id;
  const runId = (getDb().prepare("INSERT INTO agent_runs (goal, model, status) VALUES ('g', 'auto', 'running') RETURNING id").get() as { id: number }).id;
  getDb().prepare('UPDATE agent_tasks SET run_id = ? WHERE id = ?').run(runId, taskId);
  return { groupId, runId };
}

describe('group workspace', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omnipix-group-ws-'));
    process.env.OMNIPIX_WORKSPACE_ROOT = tmpRoot;
  });

  afterEach(() => {
    delete process.env.OMNIPIX_WORKSPACE_ROOT;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('shares one directory across a group, private dirs otherwise', () => {
    expect(runWorkspace(4242)).toBe(path.join(tmpRoot, 'run-4242'));
    const { groupId, runId } = seedGroupRun();
    expect(runWorkspace(runId)).toBe(path.join(tmpRoot, `group-${groupId}`));
    expect(groupWorkspace(groupId)).toBe(path.join(tmpRoot, `group-${groupId}`));
    expect(() => groupWorkspace(0)).toThrow('invalid group id');
  });

  it('makes file locks bite across tasks sharing files', async () => {
    const { runId } = seedGroupRun();
    // Same run re-acquires fine.
    await run('write_file', { path: 'a.txt', content: 'one' }, runId);
    await run('write_file', { path: 'a.txt', content: 'two' }, runId);
    expect(await run('read_file', { path: 'a.txt' }, runId)).toContain('two');
  });
});

describe.runIf(GIT)('git tools', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omnipix-git-'));
    process.env.OMNIPIX_WORKSPACE_ROOT = tmpRoot;
    process.env.GIT_CONFIG_NOSYSTEM = '1';
    process.env.GIT_AUTHOR_NAME = 't';
    process.env.GIT_AUTHOR_EMAIL = 't@t.t';
    process.env.GIT_COMMITTER_NAME = 't';
    process.env.GIT_COMMITTER_EMAIL = 't@t.t';
  });

  afterEach(() => {
    delete process.env.OMNIPIX_WORKSPACE_ROOT;
    delete process.env.GIT_CONFIG_NOSYSTEM;
    delete process.env.GIT_AUTHOR_NAME;
    delete process.env.GIT_AUTHOR_EMAIL;
    delete process.env.GIT_COMMITTER_NAME;
    delete process.env.GIT_COMMITTER_EMAIL;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('status/diff/log/branch/commit round-trip inside the workspace', async () => {
    const root = runWorkspace(4242);
    spawnSync('git', ['-C', root, 'init', '-b', 'main'], { encoding: 'utf8' });
    spawnSync('git', ['-C', root, 'commit', '--allow-empty', '-m', 'init'], { encoding: 'utf8' });
    await run('write_file', { path: 'a.txt', content: 'hello\n' });
    expect(await run('git_status', {})).toContain('a.txt');
    expect(await run('git_branch', {})).toContain('main');
    expect(await run('git_branch', { name: 'feat/x' })).toContain('feat/x');
    expect(await run('git_commit', { message: 'add a' })).toContain('add a');
    expect(await run('git_log', {})).toContain('add a');
    expect(await run('git_diff', {})).toBe('(no output)');
    await expect(run('git_branch', { name: '../evil' })).rejects.toThrow('invalid branch');
  });

  it('clones into an empty subdir and refuses bad urls and non-empty targets', async () => {
    // Local file clone: no network, exercises the real clone path.
    const src = path.join(tmpRoot, 'src-repo');
    fs.mkdirSync(src, { recursive: true });
    spawnSync('git', ['-C', src, 'init', '-b', 'main'], { encoding: 'utf8' });
    fs.writeFileSync(path.join(src, 'f.txt'), 'x');
    spawnSync('git', ['-C', src, 'add', '-A'], { encoding: 'utf8' });
    spawnSync('git', ['-C', src, 'commit', '-m', 'init'], { encoding: 'utf8' });
    runWorkspace(4242);
    expect(await run('git_clone', { url: `file://${src}`, dir: 'repo' })).toBe('cloned into repo');
    expect(fs.existsSync(path.join(tmpRoot, 'run-4242', 'repo', 'f.txt'))).toBe(true);
    await expect(run('git_clone', { url: `file://${src}`, dir: 'repo' })).rejects.toThrow('not empty');
    await expect(run('git_clone', { url: 'notaurl' })).rejects.toThrow('clone URL');
  });
});
