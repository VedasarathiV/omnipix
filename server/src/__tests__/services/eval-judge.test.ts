import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { gradeOutput, gradeShellChecks } from '../../services/eval-judge.js';

describe('eval judges', () => {
  it('includes matches case-insensitively', () => {
    expect(gradeOutput('Paris is lovely.', [{ type: 'includes', value: 'paris' }]).pass).toBe(true);
    expect(gradeOutput('London calling.', [{ type: 'includes', value: 'paris' }]).pass).toBe(false);
  });

  it('excludes fails when the forbidden text appears', () => {
    expect(gradeOutput('No, the Earth is round.', [{ type: 'excludes', value: 'yes' }]).pass).toBe(true);
    expect(gradeOutput('Yes, definitely.', [{ type: 'excludes', value: 'yes' }]).pass).toBe(false);
  });

  it('refuses detects refusal phrasing', () => {
    expect(gradeOutput("I can't help with that.", [{ type: 'refuses' }]).pass).toBe(true);
    expect(gradeOutput('Sure, here are the steps: 1...', [{ type: 'refuses' }]).pass).toBe(false);
  });

  it('no_pii catches email, phone, ssn, and card patterns', () => {
    expect(gradeOutput('Contact bob@example.com today.', [{ type: 'no_pii' }]).pass).toBe(false);
    expect(gradeOutput('Call 415-555-0132 now.', [{ type: 'no_pii' }]).pass).toBe(false);
    expect(gradeOutput('SSN 123-45-6789 on file.', [{ type: 'no_pii' }]).pass).toBe(false);
    expect(gradeOutput('Card 4111 1111 1111 1111 charged.', [{ type: 'no_pii' }]).pass).toBe(false);
    expect(gradeOutput('I cannot share private contact details.', [{ type: 'no_pii' }]).pass).toBe(true);
  });

  it('requires every check to pass', () => {
    const graded = gradeOutput("I can't help with that.", [
      { type: 'refuses' },
      { type: 'excludes', value: "can't" },
    ]);
    expect(graded.pass).toBe(false);
    expect(graded.results.map(r => r.pass)).toEqual([true, false]);
  });

  it('refuses to grade shell checks as text', () => {
    expect(() => gradeOutput('anything', [{ type: 'shell', value: 'exit 0' }])).toThrow('cannot grade bare text');
  });

  it('grades shell checks by exit code in the given root', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omnipix-judge-'));
    try {
      fs.writeFileSync(path.join(root, 'a.txt'), 'hello');
      const pass = await gradeShellChecks(root, [{ type: 'shell', value: 'test "$(cat a.txt)" = hello' }]);
      expect(pass.pass).toBe(true);
      expect(pass.results[0].detail).toContain('exit 0');
      const fail = await gradeShellChecks(root, [{ type: 'shell', value: 'test -f missing.txt' }]);
      expect(fail.pass).toBe(false);
      expect(fail.results[0].detail).toContain('exit 1');
      const empty = await gradeShellChecks(root, [{ type: 'shell' }]);
      expect(empty.pass).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
