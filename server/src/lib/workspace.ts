import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDb } from '../db/index.js';

// Sandboxed workspace runner for agent tools (Phase 1).
//
// Every agent run gets its own directory; every file or shell operation is
// confined to it:
//   - Paths resolve inside the run's root; `..` escapes and symlinks that
//     point outside are rejected, never followed.
//   - Shell commands run with cwd locked to the root, a scrubbed environment
//     (no *KEY*/*TOKEN*/*SECRET* leaks in), a wall-clock timeout, and a
//     denylist of destructive patterns.
//   - Output is byte-capped so a runaway command cannot flood the trace or
//     the model's context.
//
// This is the control VSCode's terminal sandboxing plays in our harness:
// the policy tier decides WHO may act, this module decides WHERE and HOW.

export const WORKSPACE_ROOT_SETTING = 'OMNIPIX_WORKSPACE_ROOT';

function dbDir(): string {
  const dbPath = process.env.OMNIPIX_DB_PATH?.trim();
  if (!dbPath || dbPath === ':memory:') return os.tmpdir();
  return path.dirname(path.resolve(dbPath));
}

/** Root holding every run workspace. Override with OMNIPIX_WORKSPACE_ROOT. */
export function workspaceRoot(): string {
  const override = process.env[WORKSPACE_ROOT_SETTING]?.trim();
  const root = override ? path.resolve(override) : path.join(dbDir(), 'omnipix-workspaces');
  fs.mkdirSync(root, { recursive: true });
  return root;
}

/** The workspace directory for one run, created on first use. */
export function runWorkspace(runId: number): string {
  if (!Number.isSafeInteger(runId) || runId <= 0) throw new Error('invalid run id');
  // Child runs share their parent's workspace so a delegation can act on the
  // same files; team runs share their group's directory; standalone runs
  // keep a private dir. The lookups are best-effort: without a DB (unit
  // contexts) every run is standalone.
  try {
    // Walk to the delegation root (bounded: parent links only ever point at
    // older rows, so a cycle is impossible, but never loop on DB content).
    let root = runId;
    const seen = new Set<number>([runId]);
    for (let depth = 0; depth < 8; depth++) {
      const row = getDb().prepare('SELECT parent_run_id FROM agent_runs WHERE id = ?').get(root) as { parent_run_id?: number | null } | undefined;
      if (!row?.parent_run_id || seen.has(row.parent_run_id)) break;
      seen.add(row.parent_run_id);
      root = row.parent_run_id;
    }
    // Explicit working directory wins: the run executes inside the user's
    // folder (set at creation, validated there). Never created here — a
    // missing dir is a loud error, not a silent fallback, so tools never
    // act somewhere the operator didn't choose.
    const own = getDb().prepare('SELECT workdir FROM agent_runs WHERE id = ?').get(root) as { workdir?: string | null } | undefined;
    if (own?.workdir) {
      const dir = path.resolve(own.workdir);
      const stat = fs.statSync(dir, { throwIfNoEntry: false });
      if (!stat?.isDirectory()) throw new Error(`Run working directory is gone: ${own.workdir}`);
      return dir;
    }
    const task = getDb().prepare('SELECT group_id FROM agent_tasks WHERE run_id = ?').get(root) as { group_id: number } | undefined;
    if (task) return groupWorkspace(task.group_id);
    const dir = path.join(workspaceRoot(), `run-${root}`);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  } catch (err) {
    // A chosen workdir that vanished must stay loud: rethrow instead of
    // silently falling back to a private dir the operator didn't pick.
    if (err instanceof Error && err.message.startsWith('Run working directory is gone:')) throw err;
    // No DB — fall through to the private dir.
  }
  const dir = path.join(workspaceRoot(), `run-${runId}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** The shared workspace directory for one agent group, created on first use. */
export function groupWorkspace(groupId: number): string {
  if (!Number.isSafeInteger(groupId) || groupId <= 0) throw new Error('invalid group id');
  const dir = path.join(workspaceRoot(), `group-${groupId}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Resolve a workspace-relative path to an absolute one inside root.
 * Rejects absolute paths, `..` escapes, and symlinks pointing outside.
 */
export function resolveInRoot(root: string, rel: string): string {
  if (!rel || typeof rel !== 'string') throw new Error('path must be a non-empty string');
  if (path.isAbsolute(rel)) throw new Error(`absolute paths are not allowed: ${rel}`);
  const abs = path.resolve(root, rel);
  const relToRoot = path.relative(root, abs);
  if (relToRoot === '' || relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) {
    throw new Error(`path escapes the workspace: ${rel}`);
  }
  // Symlink check on the nearest existing ancestor: a link inside the root
  // pointing at /etc must not become a write primitive.
  let probe = abs;
  for (;;) {
    if (fs.existsSync(probe)) {
      const real = fs.realpathSync(probe);
      const back = path.relative(fs.realpathSync(root), real);
      if (back.startsWith('..') || path.isAbsolute(back)) {
        throw new Error(`path escapes the workspace via symlink: ${rel}`);
      }
      return abs;
    }
    const parent = path.dirname(probe);
    if (parent === probe) return abs;
    probe = parent;
  }
}

// ── Shell ────────────────────────────────────────────────────────────────────

// Denied command shapes. This is a backstop, not a sandbox proof: the cwd
// lock, timeout, and approval tier do the real work; these catch the
// obviously destructive one-liners before they run.
const DENIED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+((-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)\s+.*(~|\$HOME|\$\{HOME\}|\/\*?(\s|$))|.*\/\s*$)/i, reason: 'recursive remove touching /, home, or globs' },
  { pattern: /:\(\)\s*\{[^}]*:\s*\|\s*:[^}]*\}\s*;?\s*:/, reason: 'fork bomb' },
  { pattern: /\bfind\s+\/\S*\s+[^|;&]*-delete\b/, reason: 'find / -delete' },
  { pattern: /\bfind\b[^|;&]*-exec[^|;&]*\brm\s+-[a-zA-Z]*[rR]/i, reason: 'find -exec recursive remove' },
  { pattern: /\b(mkfs|dd\s+.*of=|diskutil\s+erase|format\s+[a-z]:)/i, reason: 'disk formatting' },
  { pattern: /\b(shutdown|reboot|halt|poweroff)\b/i, reason: 'power control' },
  { pattern: /(curl|wget)\s+[^|]+\|\s*(sh|bash|zsh|pwsh|powershell)/i, reason: 'piping downloads into a shell' },
  { pattern: /\bchmod\s+-R\s+777\s+\//, reason: 'chmod -R 777 on /' },
  { pattern: />\s*\/dev\/(sd[a-z]|hd[a-z]|nvme)/i, reason: 'raw disk write' },
];

export function assertCommandAllowed(command: string): void {
  for (const { pattern, reason } of DENIED_PATTERNS) {
    if (pattern.test(command)) throw new Error(`command denied by policy (${reason})`);
  }
}

export function scrubEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  const kept: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    // Secrets never ride into a child shell: keys, tokens, and the gateway's
    // own encryption key stay in this process.
    if (/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|ENCRYPTION/i.test(key)) continue;
    kept[key] = value;
  }
  kept.CI = 'true';
  kept.NO_COLOR = '1';
  kept.TERM = 'dumb';
  // Caller extras (hook payloads) ride along under the same scrub: a secret
  // smuggled in as an extra is dropped, never exported.
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|ENCRYPTION/i.test(key)) continue;
      kept[key] = value;
    }
  }
  return kept;
}

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  truncated: boolean;
  /** Where the command ran — the trace shows this so sandbox use is visible. */
  sandbox: 'process' | 'docker';
}

export interface ShellOptions {
  cwd: string;
  timeoutMs?: number;
  maxBytes?: number;
  onOutput?: (chunk: string, stream: 'stdout' | 'stderr') => void;
  /** Extra env vars for the child, applied under the same secret scrub. */
  envExtra?: Record<string, string>;
}

export const DEFAULT_SHELL_TIMEOUT_MS = 60_000;
export const DEFAULT_SHELL_MAX_BYTES = 64 * 1024;

// Container sandbox: with OMNIPIX_SANDBOX=docker, shell commands run inside
// an ephemeral container (workspace bind-mounted at /work) instead of on the
// host. Network defaults to none; the image is operator-chosen. Requesting
// docker without a working daemon fails loudly — never a silent downgrade.
export const DEFAULT_SANDBOX_IMAGE = 'node:22-slim';

let dockerAvailable: boolean | null = null;

/** Test seam: force docker present/absent regardless of the daemon. */
export function __setDockerAvailable(value: boolean | null): void {
  dockerAvailable = value;
}

export function sandboxBackend(): 'process' | 'docker' {
  return (process.env.OMNIPIX_SANDBOX ?? '').trim().toLowerCase() === 'docker' ? 'docker' : 'process';
}

function dockerReady(): boolean {
  if (dockerAvailable !== null) return dockerAvailable;
  try {
    const probed = spawnSync('docker', ['info'], { encoding: 'utf8', timeout: 8000, windowsHide: true });
    dockerAvailable = probed.status === 0;
  } catch {
    dockerAvailable = false;
  }
  return dockerAvailable;
}

function scrubbedExtras(extra?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|ENCRYPTION/i.test(key)) continue;
      out[key] = value;
    }
  }
  return out;
}

let containerSeq = 0;

/** Pure docker argv builder (unit-tested); execShell is the only caller. */
export function dockerRunArgs(cwd: string, command: string, opts: ShellOptions): { argv: string[]; name: string } {
  const name = `omnipix-${process.pid}-${++containerSeq}`;
  const image = (process.env.OMNIPIX_SANDBOX_IMAGE ?? '').trim() || DEFAULT_SANDBOX_IMAGE;
  const network = (process.env.OMNIPIX_SANDBOX_NETWORK ?? '').trim() || 'none';
  const argv = ['run', '--rm', '-i', '--name', name, '--network', network, '-v', `${cwd}:/work`, '-w', '/work'];
  for (const [key, value] of Object.entries(scrubbedExtras(opts.envExtra))) {
    argv.push('--env', `${key}=${value}`);
  }
  argv.push(image, '/bin/sh', '-c', command);
  return { argv, name };
}

/** Run one shell command, confined and bounded. Never throws on exit != 0. */
export function execShell(command: string, opts: ShellOptions): Promise<ShellResult> {
  assertCommandAllowed(command);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_SHELL_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_SHELL_MAX_BYTES;
  const useDocker = sandboxBackend() === 'docker';
  if (useDocker && !dockerReady()) {
    throw new Error('docker sandbox requested (OMNIPIX_SANDBOX=docker) but no docker daemon is available');
  }
  const docker = useDocker ? dockerRunArgs(opts.cwd, command, opts) : null;
  return new Promise<ShellResult>(resolve => {
    const child = docker
      ? spawn('docker', docker.argv, { env: process.env, windowsHide: true })
      : spawn(command, {
        cwd: opts.cwd,
        env: scrubEnv(opts.envExtra),
        shell: process.platform === 'win32' ? true : '/bin/sh',
        windowsHide: true,
      });
    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let truncated = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (docker) {
        // Killing the client orphans the container; kill by name instead.
        // Best-effort and synchronous: the close handler resolves right after.
        try { spawnSync('docker', ['kill', docker.name], { timeout: 5000, windowsHide: true }); } catch { /* gone */ }
        try { spawnSync('docker', ['rm', '-f', docker.name], { timeout: 5000, windowsHide: true }); } catch { /* gone */ }
      }
      child.kill('SIGTERM');
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // Already dead — the exit handler below resolves.
        }
      }, 2000).unref?.();
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    const append = (stream: 'stdout' | 'stderr', data: Buffer): void => {
      opts.onOutput?.(data.toString('utf8'), stream);
      if (stream === 'stdout') {
        if (stdoutBytes + data.length > maxBytes) {
          truncated = true;
          return;
        }
        stdoutBytes += data.length;
        stdout += data.toString('utf8');
      } else {
        if (stderrBytes + data.length > maxBytes) {
          truncated = true;
          return;
        }
        stderrBytes += data.length;
        stderr += data.toString('utf8');
      }
    };
    child.stdout?.on('data', (data: Buffer) => append('stdout', data));
    child.stderr?.on('data', (data: Buffer) => append('stderr', data));
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: null, timedOut, truncated, sandbox: docker ? 'docker' : 'process' });
    });
    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code, timedOut, truncated, sandbox: docker ? 'docker' : 'process' });
    });
  });
}

// ── Search ───────────────────────────────────────────────────────────────────

export interface GrepMatch {
  file: string;
  line: number;
  text: string;
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', 'coverage',
  'vendor', '__pycache__', '.venv', 'venv', '.idea', '.vscode', 'target',
]);
const MAX_FILE_BYTES = 1024 * 1024;

let rgAvailable: boolean | null = null;

function hasRipgrep(): boolean {
  if (rgAvailable !== null) return rgAvailable;
  try {
    const probed = spawnSync('rg', ['--version'], { encoding: 'utf8', timeout: 5000 });
    rgAvailable = probed.status === 0;
  } catch {
    rgAvailable = false;
  }
  return rgAvailable;
}

function walkFiles(root: string, out: string[], cap: number): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= cap) return;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(root, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      walkFiles(full, out, cap);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
}

/**
 * Regular files under root, minus dependency/build dirs and symlinks.
 * Shared by the grep fallback and the security scanner so both see the
 * same tree. Capped — callers that need everything pass Infinity.
 */
export function walkWorkspaceFiles(root: string, cap = 5000): string[] {
  const out: string[] = [];
  walkFiles(root, out, Math.max(0, cap));
  out.sort();
  return out;
}

/**
 * Fixed-string search across the workspace. ripgrep when present (fast path),
 * a bounded JS walk otherwise. Binary and oversized files are skipped;
 * results are capped so a broad pattern cannot flood the trace.
 */
export function grepSearch(root: string, pattern: string, limit = 50): GrepMatch[] {
  if (!pattern) throw new Error('pattern must be a non-empty string');
  const capped = Math.min(200, Math.max(1, limit));
  if (hasRipgrep()) {
    const probed = spawnSync(
      'rg', ['--fixed-strings', '--line-number', '--no-heading', '--max-count', '5',
        '--max-filesize', '1M', '--glob', '!node_modules', '--glob', '!.git', pattern, '.'],
      { cwd: root, encoding: 'utf8', timeout: 15000, maxBuffer: 4 * 1024 * 1024 },
    );
    const out: GrepMatch[] = [];
    for (const line of (probed.stdout ?? '').split('\n')) {
      if (out.length >= capped) break;
      const match = /^(.+?):(\d+):(.*)$/.exec(line);
      if (match) out.push({ file: match[1], line: Number(match[2]), text: match[3].slice(0, 300) });
    }
    return out;
  }
  const files = walkWorkspaceFiles(root, Number.POSITIVE_INFINITY);
  const out: GrepMatch[] = [];
  for (const full of files) {
    if (out.length >= capped) break;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (stat.size > MAX_FILE_BYTES) continue;
    let content: string;
    try {
      content = fs.readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    if (content.includes('\0')) continue;
    const lines = content.split('\n');
    let perFile = 0;
    for (let i = 0; i < lines.length && perFile < 5; i++) {
      if (out.length >= capped) break;
      if (lines[i].includes(pattern)) {
        perFile++;
        out.push({ file: path.relative(root, full), line: i + 1, text: lines[i].slice(0, 300) });
      }
    }
  }
  return out;
}

/** Test seam: force the JS fallback (or ripgrep) regardless of PATH. */
export function __setRipgrepAvailable(value: boolean | null): void {
  rgAvailable = value;
}

function runGitRaw(args: string[], opts: { cwd?: string; timeoutMs: number }): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    // No shell: argv array, so URLs and refs cannot inject commands.
    const child = spawn('git', args, {
      cwd: opts.cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
      timeout: opts.timeoutMs,
      windowsHide: true,
    });
    let out = '';
    let err = '';
    child.stdout?.on('data', (d: Buffer) => { out += d.toString('utf8'); });
    child.stderr?.on('data', (d: Buffer) => { err += d.toString('utf8'); });
    child.on('error', (e: Error) => reject(new Error(`git failed: ${e.message}`)));
    child.on('close', (code: number | null) => {
      if (code !== 0) {
        reject(new Error(`git ${args[0]} failed: ${(err || out).trim().slice(0, 1000) || `exit ${code}`}`));
        return;
      }
      resolve(out.trim());
    });
  });
}

/**
 * Clone an https repo into an empty dir, optionally at a branch/tag/SHA.
 * Shared by benchmark eval items and the PR-review endpoint: unattended
 * server-side clones are https-only (no ssh keys or file URLs on the
 * server), shallow, timed out, and never prompt for credentials.
 */
export async function cloneRepoAtRef(url: string, targetDir: string, ref?: string, timeoutMs = 120_000): Promise<void> {
  if (!/^https:\/\/.+/.test(url)) throw new Error('clone URL must be https');
  const wanted = ref?.trim() || undefined;
  if (wanted) cleanRef(wanted, 'ref');
  try {
    const probed = spawnSync('git', ['--version'], { encoding: 'utf8', timeout: 5000 });
    if (probed.status !== 0) throw new Error('unavailable');
  } catch {
    throw new Error('git is not installed in this environment');
  }
  fs.mkdirSync(targetDir, { recursive: true });
  if (fs.readdirSync(targetDir).length > 0) throw new Error('clone target is not empty');
  const isSha = !!wanted && /^[0-9a-f]{4,64}$/i.test(wanted);
  if (wanted && !isSha) {
    await runGitRaw(['clone', '--depth', '1', '--branch', wanted, url, targetDir], { timeoutMs });
    return;
  }
  await runGitRaw(['clone', '--depth', '1', url, targetDir], { timeoutMs });
  if (isSha && wanted) {
    await runGitRaw(['-C', targetDir, 'fetch', '--depth', '1', 'origin', wanted], { timeoutMs });
    await runGitRaw(['-C', targetDir, 'checkout', '--detach', wanted], { timeoutMs });
  }
}

function cleanRef(ref: string, what: string): string {
  const clean = ref.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._\-/]*$/.test(clean) || clean.includes('..') || clean.includes('@{')) {
    throw new Error(`invalid ${what}: ${ref}`);
  }
  return clean;
}

/**
 * Fetch one ref into an existing clone (shallow, timed out). Used by the
 * PR-review endpoint to bring the base ref into a head checkout.
 */
export async function fetchRefInto(cwd: string, ref: string, timeoutMs = 120_000): Promise<void> {
  await runGitRaw(['-C', cwd, 'fetch', '--depth', '100', 'origin', cleanRef(ref, 'ref')], { timeoutMs });
}

/**
 * Short diff stat between a base ref and the checkout. Never throws: review
 * prompts degrade to the file list, then to nothing, rather than failing.
 */
export async function diffStat(cwd: string, base: string, timeoutMs = 60_000): Promise<string> {
  try {
    const stat = await runGitRaw(['-C', cwd, 'diff', '--stat', cleanRef(base, 'base'), 'HEAD'], { timeoutMs });
    return stat.slice(0, 4000);
  } catch {
    try {
      const names = await runGitRaw(['-C', cwd, 'diff', '--name-only', cleanRef(base, 'base'), 'HEAD'], { timeoutMs });
      return `Changed files:\n${names.slice(0, 2000)}`;
    } catch {
      return '(diff unavailable)';
    }
  }
}
