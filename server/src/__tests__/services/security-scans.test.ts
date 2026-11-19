import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initDb, getDb } from '../../db/index.js';
import {
  __resetScanGuard,
  getScanSettings,
  listFindings,
  listScans,
  runSecurityScan,
  scanWorkspace,
  tickSecurityScans,
  updateScanSettings,
} from '../../services/security-scans.js';

let tmpRoot: string;

function writeWs(workspace: string, rel: string, content: string | Buffer): void {
  const abs = path.join(tmpRoot, workspace, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function notificationCount(): number {
  return (getDb().prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind = 'security-scan'").get() as { n: number }).n;
}

describe('security scans', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omnipix-secscan-'));
    process.env.OMNIPIX_WORKSPACE_ROOT = tmpRoot;
    __resetScanGuard();
  });

  afterEach(() => {
    delete process.env.OMNIPIX_WORKSPACE_ROOT;
    __resetScanGuard();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('finds secrets and risky code with severities', () => {
    writeWs('run-1', 'app.py', [
      'key = "AKIAIOSFODNN7EXAMPLE"',
      'token = "ghp_abcdefghijklmnopqrstuvwx"',
      'password = "s3cr3t-value"',
      'result = eval(user_input)',
      'subprocess.call("ls " + filename, shell=True)',
      'chmod 777 /tmp/x',
      'homepage = "http://example.com/docs"',
      'print("clean line")',
    ].join('\n'));
    const findings = scanWorkspace(path.join(tmpRoot, 'run-1'), 'run-1');
    const byPattern = new Map(findings.map(f => [f.pattern, f]));
    expect(byPattern.get('aws-key')).toMatchObject({ severity: 'high', file: 'app.py', line: 1 });
    expect(byPattern.get('github-token')?.severity).toBe('high');
    expect(byPattern.get('password-assign')?.severity).toBe('high');
    expect(byPattern.get('eval-call')).toMatchObject({ severity: 'medium', line: 4 });
    expect(byPattern.get('shell-true')).toMatchObject({ severity: 'medium', line: 5 });
    expect(byPattern.get('chmod-777')?.severity).toBe('low');
    expect(byPattern.get('http-url')?.severity).toBe('low');
    expect(findings).toHaveLength(7);
    expect(byPattern.get('aws-key')?.excerpt).toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('avoids the obvious false positives', () => {
    writeWs('run-1', 'app.js', [
      'const apiUrl = "http://localhost:3000/v1";',
      'const password = "";',
      'const token = "short";',
      '// TODO: never eval() user input',
      'const query = "SELECT * FROM users";',
    ].join('\n'));
    const findings = scanWorkspace(path.join(tmpRoot, 'run-1'), 'run-1');
    // Only the eval( mention hits: the scanner flags the construct even in
    // comments (excerpt shows context); everything else stays quiet.
    expect(findings.map(f => f.pattern)).toEqual(['eval-call']);
  });

  it('skips dependency dirs, binaries, and oversized files', () => {
    writeWs('run-1', 'node_modules/evil/index.js', 'eval("x")');
    writeWs('run-1', '.git/objects/pack', 'AKIAIOSFODNN7EXAMPLE');
    writeWs('run-1', 'img.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x41, 0x4b, 0x49, 0x41]));
    writeWs('run-1', 'big.log', `${'x'.repeat(1024 * 1024 + 1)}AKIAIOSFODNN7EXAMPLE`);
    writeWs('run-1', 'src/ok.js', 'console.log("fine");');
    expect(scanWorkspace(path.join(tmpRoot, 'run-1'), 'run-1')).toHaveLength(0);
  });

  it('persists scans and notifies only on new findings', () => {
    writeWs('run-1', 'a.js', 'const k = "AKIAIOSFODNN7EXAMPLE";');
    writeWs('run-2', 'b.js', 'console.log("clean");');
    writeWs('group-3', 'c.js', 'eval("x");');

    const first = runSecurityScan('manual');
    expect(first).toMatchObject({ trigger: 'manual', status: 'done', workspace_count: 3, finding_count: 2, new_count: 2 });
    expect(listFindings(first.id)).toHaveLength(2);
    expect(notificationCount()).toBe(1);

    // Identical rescan: findings persist, but nothing new nags.
    const second = runSecurityScan('manual');
    expect(second.new_count).toBe(0);
    expect(notificationCount()).toBe(1);

    // A new finding in a new file nags once.
    writeWs('run-2', 'd.js', 'password = "hunter2-hunter2";');
    const third = runSecurityScan('manual');
    expect(third.new_count).toBe(1);
    expect(notificationCount()).toBe(2);
    expect(listScans().map(s => s.id)).toEqual([third.id, second.id, first.id]);
  });

  it('ignores non-workspace directories', () => {
    writeWs('.checkpoints', 'run-1/1/a.js', 'eval("old snapshot");');
    writeWs('stray-dir', 'a.js', 'eval("not a workspace");');
    const scan = runSecurityScan('manual');
    expect(scan.workspace_count).toBe(0);
    expect(scan.finding_count).toBe(0);
  });

  it('ticks on schedule only when enabled and due', () => {
    writeWs('run-1', 'a.js', 'console.log("clean");');
    expect(getScanSettings()).toMatchObject({ enabled: true, schedule: '0 3 * * *' });

    // No next set: first tick scans immediately and schedules the 3am run.
    tickSecurityScans(new Date('2026-11-18T10:00:00Z'));
    expect(listScans()).toHaveLength(1);
    const next = getScanSettings().nextRunAt;
    expect(next).toBeTruthy();

    // Future next: idle tick.
    tickSecurityScans(new Date('2026-11-18T11:00:00Z'));
    expect(listScans()).toHaveLength(1);

    // Disabled: a due tick still skips.
    updateScanSettings({ enabled: false });
    tickSecurityScans(new Date('2026-11-20T10:00:00Z'));
    expect(listScans()).toHaveLength(1);

    // Re-enabled with a past next: fires.
    updateScanSettings({ enabled: true });
    tickSecurityScans(new Date('2026-11-20T10:00:00Z'));
    expect(listScans()).toHaveLength(2);
  });

  it('validates scan settings', () => {
    expect(() => updateScanSettings({ schedule: 'not a cron' })).toThrow('Invalid cron');
    expect(updateScanSettings({ schedule: '*/15 * * * *' }).schedule).toBe('*/15 * * * *');
    expect(updateScanSettings({ enabled: false }).enabled).toBe(false);
  });
});
