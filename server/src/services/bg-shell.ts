import { spawn, type ChildProcess } from 'node:child_process';
import { assertCommandAllowed, sandboxBackend, scrubEnv } from '../lib/workspace.js';

// Background shell jobs: dev servers, watchers, and other long-lived
// processes an agent run needs alive across steps. A foreground shell_exec
// caps at 5 minutes and blocks the turn; these start, stream into a ring
// buffer, and are polled/killed by id.
//
// Records live in memory, scoped by run id: a run can only see its own
// jobs, and finishRun reaps every leftover so a stopped run never leaks a
// server. A server restart orphans the children (documented, accepted —
// the dashboard is a single local process and jobs are dev-scoped).

export const BG_MAX_JOBS_PER_RUN = 5;
export const BG_MAX_RUNTIME_MS = 30 * 60_000;
export const BG_DEFAULT_RUNTIME_MS = 10 * 60_000;
const BG_RING_LINES = 1000;
const BG_LINE_CHARS = 2000;

export type BgJobStatus = 'running' | 'exited' | 'killed' | 'timeout';

export interface BgJob {
  id: string;
  runId: number;
  cmd: string;
  pid: number | null;
  startedAt: number;
  status: BgJobStatus;
  exitCode: number | null;
  totalLines: number;
  output: string[];
}

interface LiveJob extends BgJob {
  child: ChildProcess | null;
  timer: NodeJS.Timeout | null;
  pending: string;
}

const jobs = new Map<string, LiveJob>();
let counter = 0;

function key(runId: number, id: string): string {
  return `${runId}:${id}`;
}

function pushLine(job: LiveJob, line: string): void {
  job.totalLines += 1;
  job.output.push(line.slice(0, BG_LINE_CHARS));
  if (job.output.length > BG_RING_LINES) job.output.splice(0, job.output.length - BG_RING_LINES);
}

function settle(job: LiveJob, status: BgJobStatus, exitCode: number | null): void {
  if (job.timer) {
    clearTimeout(job.timer);
    job.timer = null;
  }
  if (job.pending) {
    pushLine(job, job.pending);
    job.pending = '';
  }
  job.status = status;
  job.exitCode = exitCode;
  job.child = null;
}

export function listBgJobs(runId: number): BgJob[] {
  return [...jobs.values()].filter(j => j.runId === runId).map(({ child: _c, timer: _t, pending: _p, ...rest }) => rest);
}

function getJob(runId: number, id: string): LiveJob {
  const job = jobs.get(key(runId, id));
  if (!job) {
    const known = listBgJobs(runId).map(j => j.id);
    throw new Error(`unknown background job: ${id}${known.length ? `. Known: ${known.join(', ')}` : ''}`);
  }
  return job;
}

export function startBgJob(runId: number, cmd: string, cwd: string, maxRuntimeMs?: number): BgJob {
  if (sandboxBackend() === 'docker') {
    throw new Error('background jobs need the process sandbox (OMNIPIX_SANDBOX=docker cannot supervise them)');
  }
  assertCommandAllowed(cmd);
  const command = cmd.trim();
  if (!command) throw new Error('command is required');
  if (listBgJobs(runId).filter(j => j.status === 'running').length >= BG_MAX_JOBS_PER_RUN) {
    throw new Error(`job limit reached (${BG_MAX_JOBS_PER_RUN} running per run)`);
  }
  const runtime = typeof maxRuntimeMs === 'number' && Number.isFinite(maxRuntimeMs)
    ? Math.min(BG_MAX_RUNTIME_MS, Math.max(100, Math.floor(maxRuntimeMs)))
    : BG_DEFAULT_RUNTIME_MS;
  counter += 1;
  const id = `job${counter}`;
  const child = spawn(command, {
    cwd,
    env: scrubEnv(),
    shell: process.platform === 'win32' ? true : '/bin/sh',
    windowsHide: true,
  });
  const job: LiveJob = {
    id, runId, cmd: command, pid: child.pid ?? null, startedAt: Date.now(),
    status: 'running', exitCode: null, totalLines: 0, output: [],
    child, timer: null, pending: '',
  };
  const onData = (chunk: Buffer | string) => {
    job.pending += chunk.toString('utf8');
    const parts = job.pending.split('\n');
    job.pending = parts.pop() ?? '';
    for (const line of parts) pushLine(job, line.replace(/\r$/, ''));
  };
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);
  child.on('error', err => {
    pushLine(job, `[spawn error: ${err.message}]`);
    settle(job, 'exited', null);
  });
  child.on('exit', (code, signal) => {
    if (job.status !== 'running') return;
    settle(job, signal ? 'killed' : 'exited', code);
  });
  job.timer = setTimeout(() => {
    if (job.status !== 'running') return;
    pushLine(job, `[reaped after ${runtime}ms]`);
    try { job.child?.kill('SIGKILL'); } catch { /* already gone */ }
    settle(job, 'timeout', null);
  }, runtime);
  job.timer.unref?.();
  jobs.set(key(runId, id), job);
  const { child: _c, timer: _t, pending: _p, ...rest } = job;
  return rest;
}

export function pollBgJob(runId: number, id: string, tail = 50): BgJob & { tail: string[] } {
  const job = getJob(runId, id);
  const n = Math.min(BG_RING_LINES, Math.max(1, Math.floor(tail)));
  const { child: _c, timer: _t, pending: _p, output, ...rest } = job;
  return { ...rest, output, tail: output.slice(-n) };
}

export function killBgJob(runId: number, id: string): BgJob {
  const job = getJob(runId, id);
  if (job.status === 'running') {
    try { job.child?.kill('SIGKILL'); } catch { /* already gone */ }
    settle(job, 'killed', null);
  }
  const { child: _c, timer: _t, pending: _p, ...rest } = job;
  return rest;
}

/** Reap every job of a finished run. Returns the number killed. */
export function killRunJobs(runId: number): number {
  let killed = 0;
  for (const job of jobs.values()) {
    if (job.runId !== runId) continue;
    if (job.status === 'running') {
      try { job.child?.kill('SIGKILL'); } catch { /* already gone */ }
      killed += 1;
    }
    if (job.timer) clearTimeout(job.timer);
    jobs.delete(key(runId, job.id));
  }
  return killed;
}
