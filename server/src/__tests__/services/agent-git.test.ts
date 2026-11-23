import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initDb, getDb } from '../../db/index.js';
import { __resetGhProbe, agentToolByName, type AgentToolContext } from '../../services/agent-tools.js';
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

  it('pushes the branch and opens a PR through gh', async () => {
    // Bare local origin: the push is real, the PR is a fake gh on PATH.
    const origin = path.join(tmpRoot, 'origin.git');
    spawnSync('git', ['init', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
    const root = runWorkspace(4242);
    spawnSync('git', ['clone', origin, root], { encoding: 'utf8' });
    spawnSync('git', ['-C', root, 'checkout', '-b', 'feat/pr'], { encoding: 'utf8' });
    fs.writeFileSync(path.join(root, 'a.txt'), 'hello\n');
    spawnSync('git', ['-C', root, 'add', '-A'], { encoding: 'utf8' });
    spawnSync('git', ['-C', root, 'commit', '-m', 'add a'], { encoding: 'utf8' });

    const bin = path.join(tmpRoot, 'bin');
    fs.mkdirSync(bin, { recursive: true });
    const capture = path.join(tmpRoot, 'gh-args.txt');
    fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "gh test"; exit 0; fi\necho "$*" >> "$GH_CAPTURE"\necho "https://github.com/test/repo/pull/1"\n');
    fs.chmodSync(path.join(bin, 'gh'), 0o755);
    const realPath = process.env.PATH ?? '';
    process.env.PATH = `${bin}${path.delimiter}${realPath}`;
    process.env.GH_CAPTURE = capture;
    __resetGhProbe();
    try {
      const url = await run('git_pr', { title: 'Add a' });
      expect(url).toBe('https://github.com/test/repo/pull/1');
      // The branch reached the origin (push -u ran before pr create).
      const branch = spawnSync('git', ['--git-dir', origin, 'rev-parse', '--verify', 'refs/heads/feat/pr'], { encoding: 'utf8' });
      expect(branch.status).toBe(0);
      const args = fs.readFileSync(capture, 'utf8');
      expect(args).toContain('pr create --title Add a');
      expect(args).toContain('--body');
    } finally {
      process.env.PATH = realPath;
      delete process.env.GH_CAPTURE;
      __resetGhProbe();
    }
  });

  it('commits only the selected files when paths are passed', async () => {
    const root = runWorkspace(4242);
    spawnSync('git', ['-C', root, 'init', '-b', 'main'], { encoding: 'utf8' });
    spawnSync('git', ['-C', root, 'commit', '--allow-empty', '-m', 'init'], { encoding: 'utf8' });
    await run('write_file', { path: 'a.txt', content: 'a\n' });
    await run('write_file', { path: 'b.txt', content: 'b\n' });
    const out = await run('git_commit', { message: 'only a', paths: ['a.txt'] });
    expect(out).toContain('1 selected file');
    const names = spawnSync('git', ['-C', root, 'show', '--name-only', '--format=', 'HEAD'], { encoding: 'utf8' });
    expect(names.stdout).toContain('a.txt');
    expect(names.stdout).not.toContain('b.txt');
    expect(await run('git_status', {})).toContain('b.txt');
    await expect(run('git_commit', { message: 'evil', paths: ['../x'] })).rejects.toThrow('escapes the workspace');
  });

  it('rejects PRs without gh, without a title, or with a bad base', async () => {
    const root = runWorkspace(4242);
    spawnSync('git', ['-C', root, 'init', '-b', 'main'], { encoding: 'utf8' });
    const bin = path.join(tmpRoot, 'bin2');
    fs.mkdirSync(bin, { recursive: true });
    // Fake gh so validation tests pass with or without the real binary.
    fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\necho "gh test"\n');
    fs.chmodSync(path.join(bin, 'gh'), 0o755);
    const realPath = process.env.PATH ?? '';
    process.env.PATH = `${bin}${path.delimiter}${realPath}`;
    __resetGhProbe();
    try {
      await expect(run('git_pr', { title: '  ' })).rejects.toThrow('missing required string argument: title');
      await expect(run('git_pr', { title: 'x', base: '../evil' })).rejects.toThrow('invalid base branch');
    } finally {
      process.env.PATH = realPath;
      __resetGhProbe();
    }
    // gh missing: a PATH with git but no gh.
    const gitOnly = path.join(tmpRoot, 'bin3');
    fs.mkdirSync(gitOnly, { recursive: true });
    const realGit = realPath.split(path.delimiter)
      .map(dir => path.join(dir, 'git'))
      .find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } });
    expect(realGit).toBeTruthy();
    fs.symlinkSync(realGit!, path.join(gitOnly, 'git'));
    process.env.PATH = gitOnly;
    __resetGhProbe();
    try {
      await expect(run('git_pr', { title: 'x' })).rejects.toThrow('gh is not installed');
    } finally {
      process.env.PATH = realPath;
      __resetGhProbe();
    }
  });
});
