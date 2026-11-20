import { describe, expect, it } from 'vitest';
import {
  buildChipContext,
  distinctiveWords,
  parseSlashCommand,
  renderMessageContent,
  SLASH_COMMANDS,
} from '../../lib/compose.js';

describe('parseSlashCommand', () => {
  it('routes /clear and /plan, expands templates, passes the rest through', () => {
    expect(parseSlashCommand('/clear')).toEqual({ kind: 'clear' });
    expect(parseSlashCommand('/clear now')).toEqual({ kind: 'clear' });
    expect(parseSlashCommand('/plan')).toEqual({ kind: 'plan', rest: '' });
    expect(parseSlashCommand('/plan add auth')).toEqual({ kind: 'plan', rest: 'add auth' });
    expect(parseSlashCommand('/test')).toEqual({
      kind: 'expand', text: 'Run the test suite and report failures with file:line.',
    });
    expect(parseSlashCommand('/fix the login bug')).toEqual({
      kind: 'expand', text: 'Fix the last failure. Reproduce it first if needed, then verify the fix. the login bug',
    });
    expect(parseSlashCommand('/nope hello')).toEqual({ kind: 'none' });
    expect(parseSlashCommand('plain text')).toEqual({ kind: 'none' });
    expect(parseSlashCommand('a /test trap')).toEqual({ kind: 'none' });
  });

  it('keeps menu and parser on the same command list', () => {
    const cmds = SLASH_COMMANDS.map(s => s.cmd).sort();
    expect(cmds).toEqual(['/clear', '/commit', '/fix', '/plan', '/test']);
    for (const entry of SLASH_COMMANDS) {
      if (entry.cmd === '/clear' || entry.cmd === '/plan') continue;
      const parsed = parseSlashCommand(entry.cmd);
      expect(parsed.kind).toBe('expand');
    }
  });
});

describe('distinctiveWords', () => {
  it('extracts capped, deduped keywords', () => {
    expect(distinctiveWords('Please fix the login bug on the login page!', 6))
      .toEqual(['fix', 'login', 'bug', 'page']);
    expect(distinctiveWords('a an the 123', 6)).toEqual([]);
    expect(distinctiveWords('alpha beta gamma delta epsilon zeta', 3))
      .toEqual(['alpha', 'beta', 'gamma']);
  });
});

describe('buildChipContext', () => {
  it('prepends resolved chunks and marks misses honestly', () => {
    expect(buildChipContext('goal here', [])).toBe('goal here');
    const out = buildChipContext('do the thing', [
      { url: 'u1', title: 'Guide', chunks: [{ section: 'Auth', content: 'use tokens' }] },
      { url: 'u2', title: 'Missing', chunks: [] },
    ]);
    expect(out).toContain('--- context from Guide (u1) ---');
    expect(out).toContain('## Auth\nuse tokens');
    expect(out).toContain('--- context: Missing (u2) — no matching chunks found ---');
    expect(out).toContain('--- user request ---\ndo the thing');
  });
});

describe('renderMessageContent', () => {
  it('renders strings, arrays, and junk defensively', () => {
    expect(renderMessageContent('hi')).toBe('hi');
    expect(renderMessageContent([
      { type: 'text', text: 'see this' },
      { type: 'image_url', image_url: { url: 'data:…' } },
    ])).toBe('see this\n[image attached]');
    expect(renderMessageContent([{ type: 'text' }])).toBe('');
    expect(renderMessageContent(null)).toBe('');
    expect(renderMessageContent(42)).toBe('');
  });
});
