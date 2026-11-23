import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb, initDb } from '../../db/index.js';
import { runWorkspace } from '../../lib/workspace.js';
import { createCheckpoint } from '../../services/checkpoints.js';
import { createAgentRun, forkAgentRun, getAgentRun } from '../../services/agent-runtime.js';

let tmpRoot: string;

beforeEach(() => {
  process.env.ENCRYPTION_KEY = '0'.repeat(64);
  initDb(':memory:');
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omnipix-fork-'));
  process.env.OMNIPIX_WORKSPACE_ROOT = tmpRoot;
});

afterEach(() => {
  delete process.env.OMNIPIX_WORKSPACE_ROOT;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function seedRun(goal = 'build it'): number {
  return createAgentRun({ goal, model: 'auto' });
}

function addStep(runId: number, seq: number, kind = 'thought'): void {
  getDb().prepare('INSERT INTO agent_steps (run_id, seq, kind, name, content_json) VALUES (?, ?, ?, ?, ?)')
    .run(runId, seq, kind, kind, JSON.stringify({ text: `step ${seq}` }));
}

function writeWs(runId: number, rel: string, content: string): void {
  const abs = path.join(runWorkspace(runId), rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function readWs(runId: number, rel: string): string {
  return fs.readFileSync(path.join(runWorkspace(runId), rel), 'utf8');
}

function stepCount(runId: number): number {
  return (getDb().prepare('SELECT COUNT(*) AS n FROM agent_steps WHERE run_id = ?').get(runId) as { n: number }).n;
}

describe('forkAgentRun', () => {
  it('clones the workspace, transcript, and settings into an independent run', () => {
    const src = seedRun();
    writeWs(src, 'app.ts', 'v1');
    addStep(src, 1);
    addStep(src, 2);
    const forked = forkAgentRun(src);
    expect(forked.fromSeq).toBeNull();
    const run = getAgentRun(forked.id)!;
    expect(run.status).toBe('stopped');
    expect(run.goal).toContain('Fork of run');
    expect(stepCount(forked.id)).toBe(2);
    expect(readWs(forked.id, 'app.ts')).toBe('v1');
    // Independence: the fork's workspace is its own copy.
    writeWs(forked.id, 'app.ts', 'v2');
    expect(readWs(src, 'app.ts')).toBe('v1');
    // The fork carries a rewind-to-origin checkpoint.
    const cps = getDb().prepare('SELECT label FROM checkpoints WHERE run_id = ?').all(forked.id) as { label: string }[];
    expect(cps).toHaveLength(1);
    expect(cps[0].label).toContain(`forked from run ${src}`);
  });

  it('cuts the transcript and files at a checkpoint', () => {
    const src = seedRun();
    writeWs(src, 'app.ts', 'v1');
    addStep(src, 1);
    addStep(src, 2);
    const cp = createCheckpoint(src, 'before risky edit', 2);
    writeWs(src, 'app.ts', 'v2');
    addStep(src, 3);
    addStep(src, 4);
    const forked = forkAgentRun(src, { checkpointId: cp });
    expect(forked.fromSeq).toBe(2);
    expect(stepCount(forked.id)).toBe(2);
    expect(readWs(forked.id, 'app.ts')).toBe('v1');
  });

  it('cuts at an explicit step and honors a custom goal', () => {
    const src = seedRun();
    addStep(src, 1);
    addStep(src, 2);
    addStep(src, 3);
    const forked = forkAgentRun(src, { stepSeq: 2, goal: 'try approach B' });
    expect(forked.fromSeq).toBe(2);
    expect(stepCount(forked.id)).toBe(2);
    expect(getAgentRun(forked.id)!.goal).toBe('try approach B');
  });

  it('rejects unknown runs, foreign checkpoints, and ambiguous cuts', () => {
    expect(() => forkAgentRun(999)).toThrow('Run 999 not found');
    const a = seedRun('a');
    const b = seedRun('b');
    const cp = createCheckpoint(b, 'b snap', 0);
    expect(() => forkAgentRun(a, { checkpointId: cp })).toThrow('Checkpoint not found on this run');
    expect(() => forkAgentRun(a, { checkpointId: 1, stepSeq: 1 })).toThrow('not both');
    expect(() => forkAgentRun(a, { stepSeq: -1 })).toThrow('non-negative integer');
  });
});
