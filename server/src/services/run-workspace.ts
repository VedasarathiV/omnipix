import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../db/index.js';
import { assertCommandAllowed, execShell, resolveInRoot, runWorkspace, workspaceRoot } from '../lib/workspace.js';
import { getCheckpoint, listCheckpoints } from './checkpoints.js';

/**
 * run-workspace — read-only views over an agent run's workspace for the
 * dashboard: file tree, file content, and diffs against a checkpoint (or the
 * empty tree). Everything resolves inside the workspace root; oversized or
 * binary files are described, never dumped.
 */

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', 'coverage',
  'vendor', '__pycache__', '.venv', 'venv', '.idea', '.vscode', 'target',
  '.checkpoints',
]);
const MAX_FILES = 2000;
const MAX_FILE_BYTES = 200 * 1024;
const MAX_DIFF_FILES = 50;
const MAX_DIFF_LINES = 4000;
const MAX_HUNKS_PER_FILE = 20;
const CONTEXT_LINES = 3;

export interface WorkspaceEntry {
  path: string;
  kind: 'file' | 'dir';
  size?: number;
}

export function workspaceDir(runId: number): string {
  const row = getDb().prepare('SELECT id FROM agent_runs WHERE id = ?').get(runId);
  if (!row) throw new Error('Run not found');
  return runWorkspace(runId);
}

export function listWorkspaceFiles(runId: number): WorkspaceEntry[] {
  const root = workspaceDir(runId);
  const out: WorkspaceEntry[] = [];
  const stack: string[] = [''];
  while (stack.length && out.length < MAX_FILES) {
    const rel = stack.pop()!;
    const abs = rel ? path.join(root, rel) : root;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (out.length >= MAX_FILES) break;
      if (entry.name.startsWith('.') && entry.name !== '.env') {
        // Skip dotfiles/dirs except .env (often the thing being debugged).
        if (entry.isDirectory() || entry.name !== '.env') {
          if (entry.name !== '.env') continue;
        }
      }
      if (entry.isSymbolicLink()) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        out.push({ path: childRel, kind: 'dir' });
        stack.push(childRel);
      } else if (entry.isFile()) {
        let size = 0;
        try {
          size = fs.statSync(path.join(root, childRel)).size;
        } catch {
          continue;
        }
        out.push({ path: childRel, kind: 'file', size });
      }
    }
  }
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

export interface WorkspaceFileContent {
  path: string;
  content: string;
  truncated: boolean;
  binary: boolean;
}

export function readWorkspaceFile(runId: number, rel: string): WorkspaceFileContent {
  const root = workspaceDir(runId);
  const abs = resolveInRoot(root, rel);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    throw new Error('File not found');
  }
  if (!stat.isFile()) throw new Error('Not a file');
  const buf = fs.readFileSync(abs);
  if (buf.includes(0)) {
    return { path: rel, content: '', truncated: false, binary: true };
  }
  const sliced = buf.subarray(0, MAX_FILE_BYTES);
  return {
    path: rel,
    content: sliced.toString('utf8'),
    truncated: buf.length > MAX_FILE_BYTES,
    binary: false,
  };
}

export interface DiffLine {
  kind: 'context' | 'add' | 'del';
  oldNo: number | null;
  newNo: number | null;
  text: string;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffFile {
  path: string;
  status: 'M' | 'A' | 'D';
  added: number;
  removed: number;
  hunks: DiffHunk[];
  truncated: boolean;
}

function readLines(abs: string): string[] | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    return null;
  }
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
  const buf = fs.readFileSync(abs);
  if (buf.includes(0)) return null;
  return buf.toString('utf8').split('\n');
}

interface EditOp {
  kind: 'context' | 'add' | 'del';
  text: string;
}

/** Minimal line diff via LCS on hashed lines. Bounded: falls back to a
 *  whole-file replace hunk when the product exceeds the cap. */
function diffLines(oldLines: string[], newLines: string[]): { ops: EditOp[]; inexact: boolean } {
  const n = oldLines.length;
  const m = newLines.length;
  if (n * m > 250_000) {
    const ops: EditOp[] = [
      ...oldLines.map((text): EditOp => ({ kind: 'del', text })),
      ...newLines.map((text): EditOp => ({ kind: 'add', text })),
    ];
    return { ops, inexact: true };
  }
  // LCS table over rolling rows to keep memory O(m).
  const prev = new Array<number>(m + 1).fill(0);
  const table: number[][] = [prev.slice()];
  for (let i = 1; i <= n; i++) {
    const row = new Array<number>(m + 1).fill(0);
    for (let j = 1; j <= m; j++) {
      row[j] = oldLines[i - 1] === newLines[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], row[j - 1]);
    }
    table.push(row);
    for (let j = 0; j <= m; j++) prev[j] = row[j];
  }
  const ops: EditOp[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      ops.push({ kind: 'context', text: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || table[i][j - 1] >= table[i - 1][j])) {
      ops.push({ kind: 'add', text: newLines[j - 1] });
      j--;
    } else {
      ops.push({ kind: 'del', text: oldLines[i - 1] });
      i--;
    }
  }
  ops.reverse();
  return { ops, inexact: false };
}

function toHunks(ops: EditOp[], oldStart: number): { hunks: DiffHunk[]; added: number; removed: number; truncated: boolean } {
  const hunks: DiffHunk[] = [];
  let added = 0;
  let removed = 0;
  let truncated = false;
  // Walk ops once with running numbers, cutting hunks on long context runs.
  let oldNo = oldStart;
  let newNo = 1;
  let current: DiffLine[] = [];
  let hunkOldStart = oldStart;
  let hunkNewStart = 1;
  let contextRun = 0;
  const flush = () => {
    if (!current.some(l => l.kind !== 'context')) {
      current = [];
      return;
    }
    // Trim trailing context beyond CONTEXT_LINES.
    let tail = 0;
    for (let k = current.length - 1; k >= 0 && current[k].kind === 'context'; k--) tail++;
    const drop = Math.max(0, tail - CONTEXT_LINES);
    const kept = current.slice(0, current.length - drop);
    const oldCount = kept.filter(l => l.kind !== 'add').length;
    const newCount = kept.filter(l => l.kind !== 'del').length;
    hunks.push({
      header: `@@ -${hunkOldStart},${oldCount} +${hunkNewStart},${newCount} @@`,
      lines: kept,
    });
    current = [];
  };
  for (const op of ops) {
    if (op.kind === 'context') {
      current.push({ kind: 'context', oldNo, newNo, text: op.text });
      oldNo++;
      newNo++;
      contextRun++;
      if (contextRun > CONTEXT_LINES * 2) {
        // Keep leading context for the next hunk, flush the rest.
        const keep = current.splice(current.length - CONTEXT_LINES);
        // Back the numbers up for the kept tail (they re-render in the next hunk).
        const backOld = keep.filter(l => l.kind !== 'add').length;
        const backNew = keep.filter(l => l.kind !== 'del').length;
        flush();
        hunkOldStart = oldNo - backOld;
        hunkNewStart = newNo - backNew;
        current = keep;
        contextRun = CONTEXT_LINES;
      }
    } else {
      if (op.kind === 'add') {
        added++;
        current.push({ kind: 'add', oldNo: null, newNo, text: op.text });
        newNo++;
      } else {
        removed++;
        current.push({ kind: 'del', oldNo, newNo: null, text: op.text });
        oldNo++;
      }
      contextRun = 0;
      if (hunks.length >= MAX_HUNKS_PER_FILE) {
        truncated = true;
        break;
      }
    }
  }
  if (!truncated) flush();
  else if (current.some(l => l.kind !== 'context') && hunks.length < MAX_HUNKS_PER_FILE + 1) {
    truncated = true;
  }
  return { hunks, added, removed, truncated };
}

function collectFiles(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const stack: string[] = [''];
  while (stack.length && out.size < MAX_FILES) {
    const rel = stack.pop()!;
    const abs = rel ? path.join(root, rel) : root;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (out.size >= MAX_FILES) break;
      if (entry.name.startsWith('.')) continue;
      if (entry.isSymbolicLink()) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        stack.push(childRel);
      } else if (entry.isFile()) {
        out.set(childRel, path.join(root, childRel));
      }
    }
  }
  return out;
}

export interface WorkspaceDiff {
  against: { checkpointId: number; label: string } | null;
  files: DiffFile[];
  truncated: boolean;
}

/**
 * Revert one workspace file to a checkpoint snapshot (latest snapshot
 * containing the file by default). Added files are deleted; deleted files
 * are restored. Returns the checkpoint the content came from.
 */
export function revertWorkspaceFile(runId: number, rel: string, checkpointId?: number): { checkpointId: number; label: string; restored: boolean } {
  const root = workspaceDir(runId);
  const abs = resolveInRoot(root, rel);
  const candidates = checkpointId !== undefined
    ? [checkpointId]
    : listCheckpoints(runId).map(c => c.id);
  for (const id of candidates) {
    const checkpoint = getCheckpoint(id);
    if (!checkpoint || checkpoint.run_id !== runId) continue;
    const snapAbs = path.join(workspaceRoot(), checkpoint.rel_path, rel);
    let stat: fs.Stats | null = null;
    try {
      stat = fs.statSync(snapAbs);
    } catch {
      // Not in this snapshot — older snapshots may still hold it.
    }
    if (stat?.isFile()) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.copyFileSync(snapAbs, abs);
      return { checkpointId: id, label: checkpoint.label, restored: true };
    }
    if (checkpointId !== undefined) {
      // Explicit checkpoint lacks the file: the file was added after it.
      try {
        fs.rmSync(abs, { force: true });
      } catch {
        throw new Error('Could not remove the file');
      }
      return { checkpointId: id, label: checkpoint.label, restored: false };
    }
  }
  if (checkpointId !== undefined) throw new Error('Checkpoint not found for this run');
  // No snapshot holds the file: it was added after the oldest snapshot.
  try {
    fs.rmSync(abs, { force: true });
  } catch {
    throw new Error('Could not remove the file');
  }
  const latest = listCheckpoints(runId)[0];
  return { checkpointId: latest?.id ?? 0, label: latest?.label ?? '', restored: false };
}

function git(args: string[], cwd: string): string {
  try {
    // Trim trailing newlines only: porcelain's leading status column is data.
    return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 15_000, windowsHide: true }).replace(/[\r\n]+$/, '');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const short = message.split('\n').slice(0, 3).join(' ').slice(0, 300);
    throw new Error(short || 'git command failed');
  }
}

export interface WorkspaceGitStatus {
  isRepo: boolean;
  branch: string;
  files: Array<{ path: string; status: 'M' | 'A' | 'D' | 'U' }>;
}

export function workspaceGitStatus(runId: number): WorkspaceGitStatus {
  const root = workspaceDir(runId);
  try {
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], root);
    const porcelain = git(['status', '--porcelain=v1', '--untracked-files=normal'], root);
    const files = porcelain.split('\n').filter(Boolean).map(line => {
      const code = line.slice(0, 2);
      const filePath = line.slice(3).trim().replace(/^"(.*)"$/, '$1');
      const status = code.includes('D') ? 'D' : code.includes('A') || code.startsWith('??') ? (code.startsWith('??') ? 'U' : 'A') : 'M';
      return { path: filePath, status: status as 'M' | 'A' | 'D' | 'U' };
    });
    return { isRepo: true, branch, files };
  } catch {
    return { isRepo: false, branch: '', files: [] };
  }
}

export function workspaceGitCommit(runId: number, message: string): { sha: string } {
  const root = workspaceDir(runId);
  const trimmed = message.trim();
  if (!trimmed) throw new Error('Commit message is required');
  const status = workspaceGitStatus(runId);
  if (!status.isRepo) throw new Error('Workspace is not a git repository');
  git(['add', '-A'], root);
  git(['commit', '-m', trimmed], root);
  return { sha: git(['rev-parse', '--short', 'HEAD'], root) };
}

export function workspaceGitBranch(runId: number, name: string): { branch: string } {
  const root = workspaceDir(runId);
  const trimmed = name.trim();
  if (!trimmed || !/^[A-Za-z0-9._/-]+$/.test(trimmed)) throw new Error('Invalid branch name');
  const status = workspaceGitStatus(runId);
  if (!status.isRepo) throw new Error('Workspace is not a git repository');
  git(['checkout', '-b', trimmed], root);
  return { branch: trimmed };
}

const MAX_WRITE_BYTES = 200 * 1024;

export function writeWorkspaceFile(runId: number, rel: string, content: string): { path: string; bytes: number } {
  const root = workspaceDir(runId);
  const abs = resolveInRoot(root, rel);
  const buf = Buffer.from(content, 'utf8');
  if (buf.length > MAX_WRITE_BYTES) throw new Error('File too large (200KB max)');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
  return { path: rel, bytes: buf.length };
}

export interface SearchHit {
  path: string;
  line: number;
  text: string;
}

const SEARCH_TIMEOUT_MS = 15_000;
const SEARCH_MAX_HITS = 100;

/** Ripgrep-style workspace search over text files (fixed strings only). */
export function searchWorkspace(runId: number, query: string): SearchHit[] {
  const root = workspaceDir(runId);
  const needle = query.trim();
  if (!needle || needle.length > 200) throw new Error('Send q (1-200 chars)');
  // Short flags only: BSD grep (macOS) lacks GNU's long options.
  const args = ['-rnFI', '-m', '5', needle, '.'];
  for (const dir of SKIP_DIRS) args.push(`--exclude-dir=${dir}`);
  const proc = spawnSync('grep', args, { cwd: root, encoding: 'utf8', timeout: SEARCH_TIMEOUT_MS, maxBuffer: 1024 * 1024 });
  if (proc.error) throw new Error('Search failed to start');
  if (proc.status !== 0 && proc.status !== 1) throw new Error('Search failed');
  const hits: SearchHit[] = [];
  for (const line of (proc.stdout as string).split('\n')) {
    if (hits.length >= SEARCH_MAX_HITS) break;
    if (!line) continue;
    // ./path/to/file:line:text — path may contain colons, so split from the left twice.
    const rest = line.startsWith('./') ? line.slice(2) : line;
    const firstColon = rest.indexOf(':');
    if (firstColon < 0) continue;
    const secondColon = rest.indexOf(':', firstColon + 1);
    if (secondColon < 0) continue;
    const lineNo = Number(rest.slice(firstColon + 1, secondColon));
    if (!Number.isInteger(lineNo)) continue;
    hits.push({ path: rest.slice(0, firstColon), line: lineNo, text: rest.slice(secondColon + 1).slice(0, 300) });
  }
  return hits;
}

export interface ExecResult {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  truncated: boolean;
  durationMs: number;
}

/**
 * Run one command in the workspace as the operator (the dashboard user clicked
 * Run — this is direct execution, not an agent tool call, so no approval row).
 * Same sandbox as agent shells: cwd lock, denylist, scrubbed env, timeout cap.
 */
export async function execInWorkspace(runId: number, command: string, timeoutMs?: number): Promise<ExecResult> {
  const root = workspaceDir(runId);
  const trimmed = command.trim();
  if (!trimmed) throw new Error('Command is required');
  if (trimmed.length > 4000) throw new Error('Command too long');
  assertCommandAllowed(trimmed);
  const capped = timeoutMs === undefined ? 120_000 : Math.min(300_000, Math.max(1000, Math.floor(timeoutMs)));
  const startedAt = Date.now();
  const result = await execShell(trimmed, { cwd: root, timeoutMs: capped });
  return {
    command: trimmed,
    stdout: result.stdout.slice(0, 50_000),
    stderr: result.stderr.slice(0, 20_000),
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    truncated: result.truncated,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Diff the live workspace against a checkpoint snapshot (or the empty tree
 * when `againstId` is null, i.e. "everything the run created"). Capped so a
 * huge workspace yields a summary, never a hang.
 */
export function diffWorkspace(runId: number, againstId: number | null): WorkspaceDiff {
  const root = workspaceDir(runId);
  let base = '';
  let against: WorkspaceDiff['against'] = null;
  if (againstId !== null) {
    const checkpoint = getCheckpoint(againstId);
    if (!checkpoint || checkpoint.run_id !== runId) throw new Error('Checkpoint not found for this run');
    base = path.join(workspaceRoot(), checkpoint.rel_path);
    against = { checkpointId: checkpoint.id, label: checkpoint.label };
  }
  const live = collectFiles(root);
  const baseline = base ? collectFiles(base) : new Map<string, string>();
  const files: DiffFile[] = [];
  let truncated = false;
  let lineBudget = MAX_DIFF_LINES;

  const paths = [...new Set([...live.keys(), ...baseline.keys()])].sort();
  for (const rel of paths) {
    if (files.length >= MAX_DIFF_FILES) {
      truncated = true;
      break;
    }
    const liveAbs = live.get(rel);
    const baseAbs = baseline.get(rel);
    if (liveAbs && !baseAbs) {
      const lines = readLines(liveAbs);
      if (lines === null) {
        files.push({ path: rel, status: 'A', added: 0, removed: 0, hunks: [], truncated: true });
        continue;
      }
      const capped = lines.slice(0, 200);
      files.push({
        path: rel,
        status: 'A',
        added: lines.length,
        removed: 0,
        hunks: [{
          header: `@@ -0,0 +1,${capped.length} @@`,
          lines: capped.map((text, i): DiffLine => ({ kind: 'add', oldNo: null, newNo: i + 1, text })),
        }],
        truncated: lines.length > capped.length,
      });
    } else if (!liveAbs && baseAbs) {
      const lines = readLines(baseAbs);
      if (lines === null) {
        files.push({ path: rel, status: 'D', added: 0, removed: 0, hunks: [], truncated: true });
        continue;
      }
      const capped = lines.slice(0, 200);
      files.push({
        path: rel,
        status: 'D',
        added: 0,
        removed: lines.length,
        hunks: [{
          header: `@@ -1,${capped.length} +0,0 @@`,
          lines: capped.map((text, i): DiffLine => ({ kind: 'del', oldNo: i + 1, newNo: null, text })),
        }],
        truncated: lines.length > capped.length,
      });
    } else if (liveAbs && baseAbs) {
      const oldLines = readLines(baseAbs);
      const newLines = readLines(liveAbs);
      if (oldLines === null || newLines === null) continue;
      if (oldLines.length === newLines.length && oldLines.every((l, i) => l === newLines[i])) continue;
      const { ops } = diffLines(oldLines, newLines);
      const { hunks, added, removed, truncated: fileTruncated } = toHunks(ops, 1);
      lineBudget -= hunks.reduce((a, h) => a + h.lines.length, 0);
      files.push({ path: rel, status: 'M', added, removed, hunks, truncated: fileTruncated });
      if (lineBudget <= 0) {
        truncated = true;
        break;
      }
    }
  }
  return { against, files, truncated };
}
