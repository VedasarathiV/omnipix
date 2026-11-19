import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectChecks, parseCheckOutput, runCheck, verifyFailurePrompt } from '../../services/agent-verify.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omnipix-verify-'));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('agent verification', () => {
  it('detects npm scripts in fast-signal-first order', () => {
    fs.writeFileSync(path.join(tmpRoot, 'package.json'), JSON.stringify({
      scripts: { test: 'vitest run', lint: 'eslint .', typecheck: 'tsc -b', start: 'node .' },
    }));
    expect(detectChecks(tmpRoot).map(c => c.name)).toEqual(['typecheck', 'lint', 'test']);
  });

  it('falls back to build when no test script exists', () => {
    fs.writeFileSync(path.join(tmpRoot, 'package.json'), JSON.stringify({ scripts: { build: 'tsc' } }));
    expect(detectChecks(tmpRoot)).toEqual([{ name: 'build', command: 'npm run build --silent' }]);
  });

  it('detects Makefile targets when no package.json matches', () => {
    fs.writeFileSync(path.join(tmpRoot, 'Makefile'), 'test:\n\tgo test ./...\n\nlint:\n\tgofmt -l .\n');
    expect(detectChecks(tmpRoot).map(c => c.name)).toEqual(['make lint', 'make test']);
  });

  it('detects nothing on empty or malformed projects, never throwing', () => {
    expect(detectChecks(tmpRoot)).toEqual([]);
    fs.writeFileSync(path.join(tmpRoot, 'package.json'), 'not json{');
    expect(detectChecks(tmpRoot)).toEqual([]);
    expect(detectChecks(path.join(tmpRoot, 'missing'))).toEqual([]);
  });

  it('parses failures from output and passes on exit 0', () => {
    const failed = parseCheckOutput('ok 1\nnot ok 2 - widget\n# fail 1', 1);
    expect(failed.pass).toBe(false);
    expect(failed.summary).toContain('not ok 2');
    const passed = parseCheckOutput('all green', 0);
    expect(passed.pass).toBe(true);
  });

  it('runs a check and reports pass/fail honestly', async () => {
    const pass = await runCheck(tmpRoot, { name: 'echo', command: 'echo hi' }, { timeoutMs: 5000 });
    expect(pass).toMatchObject({ name: 'echo', pass: true, exitCode: 0, timedOut: false });
    const fail = await runCheck(tmpRoot, { name: 'nope', command: 'exit 3' }, { timeoutMs: 5000 });
    expect(fail).toMatchObject({ pass: false, exitCode: 3 });
    const slow = await runCheck(tmpRoot, { name: 'slow', command: 'sleep 30' }, { timeoutMs: 300 });
    expect(slow).toMatchObject({ pass: false, timedOut: true });
    expect(slow.summary).toContain('timed out');
  });

  it('builds a directed retry prompt from failures', () => {
    const prompt = verifyFailurePrompt([
      { name: 'test', command: 'npm test', pass: false, exitCode: 1, timedOut: false, summary: 'FAIL x' },
      { name: 'lint', command: 'npm run lint', pass: true, exitCode: 0, timedOut: false, summary: '' },
    ]);
    expect(prompt).toContain('npm test');
    expect(prompt).toContain('FAIL x');
    expect(prompt).not.toContain('lint');
  });
});
