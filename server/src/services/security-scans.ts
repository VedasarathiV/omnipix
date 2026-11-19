import fs from 'node:fs';
import path from 'node:path';
import { getDb, getSetting, setSetting } from '../db/index.js';
import { notify } from '../lib/notifications.js';
import type { Scheduler } from '../lib/scheduler.js';
import { walkWorkspaceFiles, workspaceRoot } from '../lib/workspace.js';
import { nextCronFire, parseCron } from './automations.js';

// Scheduled security scans (gap 7): a small deterministic Codex-Security-
// Cloud. Every workspace under the root is grepped for secret and risky-code
// patterns; findings persist per scan, and notifications fire only for NEW
// findings (workspace + pattern + file signature), so a standing issue nags
// exactly once. Read-only by construction: the scanner never writes into a
// workspace.

export type Severity = 'high' | 'medium' | 'low';

export interface ScanPattern {
  id: string;
  name: string;
  severity: Severity;
  regex: RegExp;
}

const PATTERNS: ScanPattern[] = [
  { id: 'aws-key', name: 'AWS access key', severity: 'high', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'github-token', name: 'GitHub token', severity: 'high', regex: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/ },
  { id: 'slack-token', name: 'Slack token', severity: 'high', regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: 'private-key', name: 'Private key block', severity: 'high', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { id: 'generic-secret', name: 'Assigned secret', severity: 'high', regex: /\b(api[_-]?key|api[_-]?secret|auth[_-]?token|access[_-]?token)\b\s*[:=]\s*['"]?[A-Za-z0-9\-_]{16,}['"]?/i },
  { id: 'password-assign', name: 'Hardcoded password', severity: 'high', regex: /\bpassword\b\s*[:=]\s*['"][^'"]{4,}['"]/i },
  { id: 'bearer-token', name: 'Bearer token', severity: 'medium', regex: /\bBearer [A-Za-z0-9\-_.~+/]{20,}={0,2}\b/ },
  { id: 'eval-call', name: 'eval() call', severity: 'medium', regex: /\beval\s*\(/ },
  { id: 'shell-true', name: 'shell=True in subprocess', severity: 'medium', regex: /\bshell\s*=\s*True\b/ },
  { id: 'new-function', name: 'new Function()', severity: 'medium', regex: /\bnew Function\s*\(/ },
  { id: 'sql-concat', name: 'SQL string concatenation', severity: 'medium', regex: /\b(SELECT|INSERT|UPDATE|DELETE)\b[^;'"`]*\+\s*['"`\w]/i },
  { id: 'shell-pipe', name: 'Download piped to shell', severity: 'medium', regex: /\b(curl|wget)\b[^|]*\|\s*(sh|bash|zsh)\b/i },
  { id: 'rm-rf', name: 'Recursive force remove', severity: 'medium', regex: /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b/i },
  { id: 'chmod-777', name: 'chmod 777', severity: 'low', regex: /\bchmod\s+(-R\s+)?777\b/ },
  { id: 'http-url', name: 'Plain-HTTP URL', severity: 'low', regex: /\bhttp:\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/ },
];

export const SCAN_MAX_FILES = 2000;
export const SCAN_MAX_FILE_BYTES = 1024 * 1024;
export const SCAN_MAX_LINE_CHARS = 2000;
export const SCAN_MAX_FINDINGS = 200;

export interface ScanFinding {
  workspace: string;
  pattern: string;
  severity: Severity;
  file: string;
  line: number;
  excerpt: string;
}

export interface ScanRow {
  id: number;
  trigger: string;
  status: string;
  workspace_count: number;
  finding_count: number;
  new_count: number;
  error: string | null;
  started_at: string;
  finished_at: string;
}

export interface FindingRow extends ScanFinding {
  id: number;
  scan_id: number;
}

function isBinary(sample: Buffer): boolean {
  return sample.includes(0);
}

/** Grep one workspace dir. Never throws — unreadable files are skipped. */
export function scanWorkspace(root: string, workspace: string): ScanFinding[] {
  const findings: ScanFinding[] = [];
  let files: string[];
  try {
    files = walkWorkspaceFiles(root, SCAN_MAX_FILES);
  } catch {
    return findings;
  }
  for (const full of files) {
    if (findings.length >= SCAN_MAX_FINDINGS) break;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (stat.size > SCAN_MAX_FILE_BYTES) continue;
    let content: string;
    try {
      const raw = fs.readFileSync(full);
      if (isBinary(raw.subarray(0, 8000))) continue;
      content = raw.toString('utf8');
    } catch {
      continue;
    }
    const rel = path.relative(root, full);
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].length > SCAN_MAX_LINE_CHARS ? lines[i].slice(0, SCAN_MAX_LINE_CHARS) : lines[i];
      for (const pattern of PATTERNS) {
        // Fresh lastIndex per test: shared global-flag regexes would skip.
        pattern.regex.lastIndex = 0;
        if (pattern.regex.test(line)) {
          findings.push({
            workspace,
            pattern: pattern.id,
            severity: pattern.severity,
            file: rel,
            line: i + 1,
            excerpt: line.trim().slice(0, 200),
          });
          break; // one finding per line: the first matching pattern wins
        }
      }
      if (findings.length >= SCAN_MAX_FINDINGS) break;
    }
  }
  return findings;
}

function signature(f: Pick<ScanFinding, 'workspace' | 'pattern' | 'file'>): string {
  return `${f.workspace}\0${f.pattern}\0${f.file}`;
}

function previousSignatures(beforeScanId: number): Set<string> {
  const row = getDb().prepare(
    "SELECT id FROM security_scans WHERE id < ? AND status = 'done' ORDER BY id DESC LIMIT 1",
  ).get(beforeScanId) as { id: number } | undefined;
  if (!row) return new Set();
  const findings = getDb().prepare(
    'SELECT workspace, pattern, file FROM security_findings WHERE scan_id = ?',
  ).all(row.id) as Pick<ScanFinding, 'workspace' | 'pattern' | 'file'>[];
  return new Set(findings.map(signature));
}

/**
 * Scan every agent workspace and persist the scan. Synchronous: plain file
 * IO, bounded by the caps above. Notifies only on new findings.
 */
export function runSecurityScan(trigger: 'manual' | 'scheduled'): ScanRow {
  const db = getDb();
  const started = new Date().toISOString();
  const row = db.prepare(
    "INSERT INTO security_scans (trigger, status, started_at, finished_at) VALUES (?, 'running', ?, ?) RETURNING *",
  ).get(trigger, started, started) as ScanRow;
  try {
    const root = workspaceRoot();
    const entries = fs.readdirSync(root, { withFileTypes: true });
    const workspaces = entries
      .filter(e => e.isDirectory() && !e.isSymbolicLink() && (e.name.startsWith('run-') || e.name.startsWith('group-')))
      .map(e => e.name)
      .sort();
    const insert = db.prepare(
      'INSERT INTO security_findings (scan_id, workspace, pattern, severity, file, line, excerpt) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    let findingCount = 0;
    const insertMany = db.transaction((all: ScanFinding[]) => {
      for (const f of all) {
        insert.run(row.id, f.workspace, f.pattern, f.severity, f.file, f.line, f.excerpt);
        findingCount++;
      }
    });
    for (const workspace of workspaces) {
      insertMany(scanWorkspace(path.join(root, workspace), workspace));
    }
    const known = previousSignatures(row.id);
    const fresh = db.prepare('SELECT workspace, pattern, file FROM security_findings WHERE scan_id = ?')
      .all(row.id) as Pick<ScanFinding, 'workspace' | 'pattern' | 'file'>[];
    const newSigs = new Set(fresh.filter(f => !known.has(signature(f))).map(signature));
    const newCount = newSigs.size;
    const finished = new Date().toISOString();
    db.prepare(
      "UPDATE security_scans SET status = 'done', workspace_count = ?, finding_count = ?, new_count = ?, finished_at = ? WHERE id = ?",
    ).run(workspaces.length, findingCount, newCount, finished, row.id);
    if (newCount > 0) {
      const rows = db.prepare('SELECT workspace, pattern, file, line FROM security_findings WHERE scan_id = ?')
        .all(row.id) as { workspace: string; pattern: string; file: string; line: number }[];
      const sample = rows.filter(f => newSigs.has(signature(f))).slice(0, 5);
      notify(
        'security-scan',
        `Security scan: ${newCount} new finding${newCount === 1 ? '' : 's'}`,
        sample.map(f => `${f.workspace}/${f.file}:${f.line} [${f.pattern}]`).join('\n'),
        '/agents?tab=assistant',
      );
    }
    return getScan(row.id)!;
  } catch (err) {
    const finished = new Date().toISOString();
    db.prepare("UPDATE security_scans SET status = 'error', error = ?, finished_at = ? WHERE id = ?")
      .run(err instanceof Error ? err.message : String(err), finished, row.id);
    return getScan(row.id)!;
  }
}

export function getScan(id: number): ScanRow | null {
  const row = getDb().prepare('SELECT * FROM security_scans WHERE id = ?').get(id) as ScanRow | undefined;
  return row ?? null;
}

export function listScans(limit = 20): ScanRow[] {
  const capped = Math.min(100, Math.max(1, limit));
  return getDb().prepare('SELECT * FROM security_scans ORDER BY id DESC LIMIT ?').all(capped) as ScanRow[];
}

export function listFindings(scanId: number): FindingRow[] {
  return getDb().prepare(
    `SELECT * FROM security_findings WHERE scan_id = ?
     ORDER BY CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, workspace, file, line`,
  ).all(scanId) as FindingRow[];
}

// ── Schedule ─────────────────────────────────────────────────────────────────

const ENABLED_SETTING = 'security_scan_enabled';
const SCHEDULE_SETTING = 'security_scan_schedule';
const NEXT_SETTING = 'security_scan_next';
export const SCAN_DEFAULT_SCHEDULE = '0 3 * * *';

export interface ScanSettings {
  enabled: boolean;
  schedule: string;
  nextRunAt: string | null;
}

export function getScanSettings(): ScanSettings {
  const enabled = (getSetting(ENABLED_SETTING) ?? '1') !== '0';
  const schedule = getSetting(SCHEDULE_SETTING) ?? SCAN_DEFAULT_SCHEDULE;
  return { enabled, schedule, nextRunAt: getSetting(NEXT_SETTING) ?? null };
}

export function updateScanSettings(patch: { enabled?: boolean; schedule?: string }): ScanSettings {
  if (patch.schedule !== undefined && !parseCron(patch.schedule)) {
    throw new Error('Invalid cron schedule: five fields (minute hour dom month dow).');
  }
  if (patch.enabled !== undefined) setSetting(ENABLED_SETTING, patch.enabled ? '1' : '0');
  if (patch.schedule !== undefined) {
    setSetting(SCHEDULE_SETTING, patch.schedule.trim());
    setSetting(NEXT_SETTING, '');
  }
  return getScanSettings();
}

let scanInFlight = false;

/** Test seam: drop the reentrancy guard. */
export function __resetScanGuard(): void {
  scanInFlight = false;
}

/** Fire a due scheduled scan. Called every minute; cheap when idle. */
export function tickSecurityScans(now = new Date()): void {
  const settings = getScanSettings();
  if (!settings.enabled || scanInFlight) return;
  const next = settings.nextRunAt ? new Date(settings.nextRunAt) : null;
  if (next && !Number.isNaN(next.getTime()) && next.getTime() > now.getTime()) return;
  scanInFlight = true;
  try {
    runSecurityScan('scheduled');
  } finally {
    scanInFlight = false;
  }
  const following = nextCronFire(settings.schedule, now);
  setSetting(NEXT_SETTING, following?.toISOString() ?? '');
}

let schedulerRunning = false;

/** Start the 60s scan tick. Idempotent. */
export function startSecurityScanScheduler(scheduler: Scheduler): void {
  if (schedulerRunning) return;
  schedulerRunning = true;
  scheduler.every(60_000, () => {
    try {
      tickSecurityScans();
    } catch {
      // A poisoned schedule must not wedge the other schedulers.
    }
  }, { name: 'security-scans' });
}
