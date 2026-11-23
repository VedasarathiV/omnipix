import os from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BG_MAX_JOBS_PER_RUN,
  killBgJob,
  killRunJobs,
  listBgJobs,
  pollBgJob,
  startBgJob,
} from '../../services/bg-shell.js';

const RUN = 424242;

afterEach(() => {
  killRunJobs(RUN);
  killRunJobs(RUN + 1);
});

async function waitFor(cond: () => boolean, ms = 5000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timed out waiting for condition');
    await new Promise(r => setTimeout(r, 25));
  }
}

describe('bg-shell', () => {
  it('runs a quick command to completion with captured output', async () => {
    const job = startBgJob(RUN, 'echo hello-bg', os.tmpdir());
    await waitFor(() => pollBgJob(RUN, job.id).status !== 'running');
    const polled = pollBgJob(RUN, job.id);
    expect(polled.status).toBe('exited');
    expect(polled.exitCode).toBe(0);
    expect(polled.tail.join('\n')).toContain('hello-bg');
  });

  it('reports a failing exit code', async () => {
    const job = startBgJob(RUN, 'exit 7', os.tmpdir());
    await waitFor(() => pollBgJob(RUN, job.id).status !== 'running');
    const polled = pollBgJob(RUN, job.id);
    expect(polled.status).toBe('exited');
    expect(polled.exitCode).toBe(7);
  });

  it('kills a long-lived job on demand', async () => {
    const job = startBgJob(RUN, 'sleep 30', os.tmpdir());
    expect(pollBgJob(RUN, job.id).status).toBe('running');
    expect(killBgJob(RUN, job.id).status).toBe('killed');
    expect(pollBgJob(RUN, job.id).status).toBe('killed');
  });

  it('reaps jobs past their max runtime', async () => {
    const job = startBgJob(RUN, 'sleep 30', os.tmpdir(), 150);
    await waitFor(() => pollBgJob(RUN, job.id).status !== 'running');
    expect(pollBgJob(RUN, job.id).status).toBe('timeout');
  });

  it('reaps every leftover with killRunJobs', () => {
    startBgJob(RUN, 'sleep 30', os.tmpdir());
    startBgJob(RUN, 'sleep 30', os.tmpdir());
    expect(killRunJobs(RUN)).toBe(2);
    expect(listBgJobs(RUN)).toEqual([]);
  });

  it('isolates jobs by run and names the known ones on a miss', () => {
    const job = startBgJob(RUN, 'sleep 30', os.tmpdir());
    expect(listBgJobs(RUN + 1)).toEqual([]);
    expect(() => pollBgJob(RUN + 1, job.id)).toThrow('unknown background job');
    expect(() => pollBgJob(RUN, 'nope')).toThrow(job.id);
  });

  it('caps running jobs per run and denies destructive commands', () => {
    for (let i = 0; i < BG_MAX_JOBS_PER_RUN; i++) startBgJob(RUN, 'sleep 30', os.tmpdir());
    expect(() => startBgJob(RUN, 'sleep 30', os.tmpdir())).toThrow('job limit reached');
    expect(() => startBgJob(RUN + 1, 'rm -rf /', os.tmpdir())).toThrow('denied by policy');
    expect(() => startBgJob(RUN + 1, '  ', os.tmpdir())).toThrow('command is required');
  });
});
