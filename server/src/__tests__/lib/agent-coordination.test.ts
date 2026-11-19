import { beforeEach, describe, expect, it } from 'vitest';
import { initDb, getDb } from '../../db/index.js';
import {
  blackboardList,
  blackboardRead,
  blackboardWrite,
  claimFileLock,
  listFileLocks,
  releaseTaskLocks,
  taskForRun,
} from '../../lib/agent-coordination.js';

function seedGroup(): number {
  return (getDb().prepare("INSERT INTO agent_groups (goal) VALUES ('g') RETURNING id").get() as { id: number }).id;
}

function seedTask(groupId: number): number {
  return (getDb().prepare(
    "INSERT INTO agent_tasks (group_id, name, role, goal) VALUES (?, 't', 'coder', 'do') RETURNING id",
  ).get(groupId) as { id: number }).id;
}

describe('group coordination', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
  });

  it('grants file locks exclusively and releases per task', () => {
    const group = seedGroup();
    const a = seedTask(group);
    const b = seedTask(group);
    claimFileLock(group, a, 'src/x.ts');
    claimFileLock(group, a, 'src/x.ts'); // re-acquire is a no-op
    expect(() => claimFileLock(group, b, 'src/x.ts')).toThrow('locked by task');
    expect(listFileLocks(group)).toEqual([{ path: 'src/x.ts', taskId: a, acquiredAt: expect.any(String) }]);
    releaseTaskLocks(group, a);
    claimFileLock(group, b, 'src/x.ts'); // free now
    expect(listFileLocks(group)).toHaveLength(1);
  });

  it('normalizes lock paths', () => {
    const group = seedGroup();
    const a = seedTask(group);
    const b = seedTask(group);
    claimFileLock(group, a, './src/x.ts');
    expect(() => claimFileLock(group, b, 'src/x.ts')).toThrow('locked by task');
  });

  it('reads and writes blackboard keys with caps', () => {
    const group = seedGroup();
    const task = seedTask(group);
    expect(blackboardRead(group, 'missing')).toBeNull();
    blackboardWrite(group, task, 'findings', { files: ['a.ts'] });
    expect(blackboardRead(group, 'findings')).toMatchObject({ value: { files: ['a.ts'] }, writerTaskId: task });
    blackboardWrite(group, task, 'findings', [1, 2]);
    expect(blackboardRead(group, 'findings')!.value).toEqual([1, 2]);
    blackboardWrite(group, task, 'big', 'x'.repeat(100000));
    const big = blackboardRead(group, 'big')!.value as { __truncated_text: string };
    expect(typeof big.__truncated_text).toBe('string');
    expect(big.__truncated_text.length).toBeLessThanOrEqual(4000);
    expect(blackboardList(group).map(e => e.key)).toEqual(['big', 'findings']);
    expect(() => blackboardWrite(group, task, '  ', 1)).toThrow('non-empty');
  });

  it('resolves the group and task owning a run', () => {
    const group = seedGroup();
    const task = seedTask(group);
    const run = getDb().prepare("INSERT INTO agent_runs (goal, model, status) VALUES ('g', 'auto', 'running') RETURNING id").get() as { id: number };
    expect(taskForRun(run.id)).toBeNull();
    getDb().prepare('UPDATE agent_tasks SET run_id = ? WHERE id = ?').run(run.id, task);
    expect(taskForRun(run.id)).toEqual({ groupId: group, taskId: task });
  });
});
