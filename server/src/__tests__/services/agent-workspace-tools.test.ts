import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initDb } from '../../db/index.js';
import { agentToolByName, renderEditPreview } from '../../services/agent-tools.js';
import { runWorkspace } from '../../lib/workspace.js';
import type { AgentToolContext } from '../../services/agent-tools.js';

let tmpRoot: string;
const ctx: AgentToolContext = { runId: 4242 };

function run(name: string, args: Record<string, unknown>): Promise<string> {
  const tool = agentToolByName(name);
  if (!tool) throw new Error(`missing tool ${name}`);
  return tool.execute(args, ctx);
}

beforeEach(() => {
  process.env.ENCRYPTION_KEY = '0'.repeat(64);
  initDb(':memory:');
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omnipix-wtools-'));
  process.env.OMNIPIX_WORKSPACE_ROOT = tmpRoot;
});

afterEach(() => {
  delete process.env.OMNIPIX_WORKSPACE_ROOT;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('workspace tools', () => {
  it('writes, reads, and edits files with numbered lines', async () => {
    const wrote = await run('write_file', { path: 'src/a.txt', content: 'one\ntwo\nthree\n' });
    expect(wrote).toContain('wrote src/a.txt (4 lines)');
    expect(await run('read_file', { path: 'src/a.txt' })).toBe('1\tone\n2\ttwo\n3\tthree\n4\t');
    expect(await run('read_file', { path: 'src/a.txt', offset: 1, limit: 1 })).toBe('2\ttwo');
    expect(await run('edit_file', { path: 'src/a.txt', find: 'two\n', replace: 'TWO\n' })).toBe('edited src/a.txt');
    expect(await run('read_file', { path: 'src/a.txt', offset: 1, limit: 1 })).toBe('2\tTWO');
  });

  it('rejects escapes, missing files, and ambiguous edits', async () => {
    await expect(run('read_file', { path: '../x' })).rejects.toThrow('escapes the workspace');
    await expect(run('write_file', { path: '/tmp/x' })).rejects.toThrow('absolute paths');
    await expect(run('read_file', { path: 'missing.txt' })).rejects.toThrow('cannot read');
    await run('write_file', { path: 'dup.txt', content: 'a\na\n' });
    await expect(run('edit_file', { path: 'dup.txt', find: 'a\n', replace: 'b\n' })).rejects.toThrow('matches 2 times');
    await expect(run('edit_file', { path: 'dup.txt', find: 'zzz', replace: 'b' })).rejects.toThrow('matches 0 times');
    await expect(run('write_file', { path: 'bin', content: 'a\0b' })).rejects.toThrow('binary');
  });

  it('searches workspace text', async () => {
    await run('write_file', { path: 'a.txt', content: 'hello needle\n' });
    await run('write_file', { path: 'b.txt', content: 'nothing\n' });
    expect(await run('grep_search', { pattern: 'needle' })).toBe('a.txt:1: hello needle');
    expect(await run('grep_search', { pattern: 'absent' })).toBe('no matches');
  });

  it('runs shell commands confined with receipts', async () => {
    const out = await run('shell_exec', { command: 'echo hi && pwd' });
    expect(out).toContain('exit=0');
    expect(out).toContain('hi');
    expect(out).toContain(path.join(tmpRoot, 'run-4242'));
    const fail = await run('shell_exec', { command: 'exit 7' });
    expect(fail).toContain('exit=7');
    await expect(run('shell_exec', { command: 'rm -rf / tmp' })).rejects.toThrow('denied by policy');
  });

  it('lists and runs repo checks', async () => {
    const root = runWorkspace(ctx.runId);
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }));
    expect(await run('run_check', {})).toBe('test: npm run test --silent');
    expect(await run('run_check', { name: 'test' })).toBe('PASS test');
    await expect(run('run_check', { name: 'nope' })).rejects.toThrow('unknown check');
    fs.rmSync(path.join(root, 'package.json'));
    expect(await run('run_check', {})).toContain('no checks detected');
  });

  it('shares blackboard findings within a group only', async () => {
    const { getDb } = await import('../../db/index.js');
    await expect(run('blackboard_write', { key: 'k', value: 'v' })).rejects.toThrow('standalone');
    const group = (getDb().prepare("INSERT INTO agent_groups (goal) VALUES ('g') RETURNING id").get() as { id: number }).id;
    const task = (getDb().prepare("INSERT INTO agent_tasks (group_id, name, role, goal) VALUES (?, 't', 'coder', 'do') RETURNING id").get(group) as { id: number }).id;
    const runId = (getDb().prepare("INSERT INTO agent_runs (goal, model, status) VALUES ('g', 'auto', 'running') RETURNING id").get() as { id: number }).id;
    getDb().prepare('UPDATE agent_tasks SET run_id = ? WHERE id = ?').run(runId, task);
    const tool = agentToolByName('blackboard_write')!;
    expect(await tool.execute({ key: 'shape', value: 'tabs' }, { runId })).toBe('published shape');
    const read = agentToolByName('blackboard_read')!;
    expect(await read.execute({ key: 'shape' }, { runId })).toBe('"tabs"');
    expect(await read.execute({}, { runId })).toBe('shape');
  });

  it('previews diffs without applying them', async () => {
    const write = agentToolByName('write_file')!;
    const preview = await write.preview!({ path: 'n.txt', content: 'hello\n' }, ctx);
    expect(preview).toContain('+++ b/n.txt');
    expect(preview).toContain('+hello');
    expect(fs.existsSync(path.join(runWorkspace(ctx.runId), 'n.txt'))).toBe(false);
    const edit = agentToolByName('edit_file')!;
    expect(await edit.preview!({ path: 'x', find: 'a', replace: 'b' }, ctx)).toContain('-a');
    expect(await edit.preview!({ path: 'x', find: '', replace: 'b' }, ctx)).toBeNull();
    expect(renderEditPreview('f', 'a', 'b')).toContain('--- a/f');
  });
});
