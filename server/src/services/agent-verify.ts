import fs from 'node:fs';
import path from 'node:path';
import { execShell, DEFAULT_SHELL_MAX_BYTES } from '../lib/workspace.js';

// Agent verification loop (Phase 1): after the agent changes files, run the
// repo's own checks and feed structured failures back for self-retry.
//
// Detection is convention-based, VSCode-tasks style: package.json scripts
// first (test, lint, typecheck), then Makefile targets (test, lint, check).
// Nothing detected means nothing runs — verification never invents commands.
// Parsing is deliberately shallow (exit code + failure-looking lines); the
// model sees the summary plus a capped tail, which is what it needs to fix.

export interface CheckDef {
  name: string;
  command: string;
}

export interface CheckResult {
  name: string;
  command: string;
  pass: boolean;
  exitCode: number | null;
  timedOut: boolean;
  /** Failure-looking lines (or the tail when nothing matches), capped. */
  summary: string;
}

export const VERIFY_TIMEOUT_MS = 180_000;
export const VERIFY_SUMMARY_MAX_LINES = 20;
export const VERIFY_SUMMARY_MAX_CHARS = 4000;

/** Detect runnable checks in a workspace. Never throws. */
export function detectChecks(root: string): CheckDef[] {
  const checks: CheckDef[] = [];
  try {
    const pkgPath = path.join(root, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> };
      const scripts = pkg.scripts ?? {};
      // Order matters: fast signal first. `test` may itself run lint/typecheck,
      // but running each explicitly names the failing gate in the trace.
      for (const name of ['typecheck', 'lint', 'test']) {
        if (typeof scripts[name] === 'string' && scripts[name].trim()) {
          checks.push({ name, command: `npm run ${name} --silent` });
        }
      }
      if (typeof scripts.build === 'string' && scripts.build.trim() && !scripts.test) {
        checks.push({ name: 'build', command: 'npm run build --silent' });
      }
    }
  } catch {
    // Malformed package.json: fall through to Makefile detection.
  }
  if (!checks.length) {
    try {
      const mkPath = path.join(root, 'Makefile');
      if (fs.existsSync(mkPath)) {
        const content = fs.readFileSync(mkPath, 'utf8');
        for (const name of ['check', 'lint', 'test']) {
          if (new RegExp(`^${name}\\s*:`, 'm').test(content)) {
            checks.push({ name: `make ${name}`, command: `make ${name}` });
          }
        }
      }
    } catch {
      // Unreadable Makefile: no checks.
    }
  }
  return checks;
}

const FAILURE_LINE = /(fail|error|✖|✗|not ok|ERR!|AssertionError|TypeError|ReferenceError|SyntaxError)/i;

export function parseCheckOutput(output: string, exitCode: number | null): { pass: boolean; summary: string } {
  const pass = exitCode === 0;
  const lines = output.split('\n');
  const hits = lines.filter(line => FAILURE_LINE.test(line)).slice(-VERIFY_SUMMARY_MAX_LINES);
  const picked = hits.length ? hits : lines.slice(-VERIFY_SUMMARY_MAX_LINES);
  return { pass, summary: picked.join('\n').slice(0, VERIFY_SUMMARY_MAX_CHARS) };
}

export async function runCheck(
  root: string,
  check: CheckDef,
  opts?: { timeoutMs?: number; onOutput?: (chunk: string, stream: 'stdout' | 'stderr') => void },
): Promise<CheckResult> {
  const result = await execShell(check.command, {
    cwd: root,
    timeoutMs: opts?.timeoutMs ?? VERIFY_TIMEOUT_MS,
    maxBytes: DEFAULT_SHELL_MAX_BYTES,
    onOutput: opts?.onOutput,
  });
  const combined = `${result.stdout}\n${result.stderr}`.trim();
  if (result.timedOut) {
    return {
      name: check.name,
      command: check.command,
      pass: false,
      exitCode: result.exitCode,
      timedOut: true,
      summary: `timed out after ${opts?.timeoutMs ?? VERIFY_TIMEOUT_MS}ms\n${combined.slice(-1000)}`,
    };
  }
  const parsed = parseCheckOutput(combined, result.exitCode);
  return {
    name: check.name,
    command: check.command,
    pass: parsed.pass,
    exitCode: result.exitCode,
    timedOut: false,
    summary: parsed.summary || '(no output)',
  };
}

/** Prompt fragment appended when checks fail, so the retry is directed. */
export function verifyFailurePrompt(results: CheckResult[]): string {
  const failed = results.filter(r => !r.pass);
  const lines = failed.map(r => `## Check failed: ${r.name} (\`${r.command}\`, exit ${r.exitCode ?? 'null'})${r.timedOut ? ' — TIMED OUT' : ''}\n${r.summary}`);
  return [
    'Your changes did not pass the repo checks. Fix the failures below and try again — do not re-explain, just repair.',
    ...lines,
  ].join('\n\n');
}
