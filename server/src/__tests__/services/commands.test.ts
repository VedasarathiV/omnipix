import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  expandCommandTemplate,
  expandFileCommand,
  parseCommandFile,
  parseCommandInvocation,
  scanCommandFiles,
} from '../../services/commands.js';

describe('command files', () => {
  it('parses description, agent, model, and template', () => {
    const parsed = parseCommandFile('---\ndescription: Review code.\nagent: reviewer\nmodel: auto\n---\nReview $ARGUMENTS\n');
    expect(parsed).toEqual({ description: 'Review code.', agent: 'reviewer', model: 'auto', template: 'Review $ARGUMENTS' });
  });

  it('rejects missing description and empty templates', () => {
    expect(() => parseCommandFile('---\nagent: x\n---\nbody')).toThrow(/needs a description/);
    expect(() => parseCommandFile('---\ndescription: D.\n---\n')).toThrow(/needs a template/);
    expect(() => parseCommandFile('no fence')).toThrow(/frontmatter fence/);
  });

  it('rejects invalid agent names', () => {
    expect(() => parseCommandFile('---\ndescription: D.\nagent: Bad Name\n---\nbody')).toThrow(/valid command\/agent name/);
  });
});

describe('expandCommandTemplate', () => {
  it('substitutes positional args, last one greedy', () => {
    expect(expandCommandTemplate('Fix $1 in $2', 'auth login flow')).toBe('Fix auth in login flow');
    expect(expandCommandTemplate('$1 vs $2', 'a b c d')).toBe('a vs b c d');
  });

  it('substitutes $ARGUMENTS with the whole input', () => {
    expect(expandCommandTemplate('Review:\n$ARGUMENTS', 'src/x.ts and tests')).toBe('Review:\nsrc/x.ts and tests');
  });

  it('appends input when the template has no placeholders', () => {
    expect(expandCommandTemplate('Do the thing.', 'with care')).toBe('Do the thing.\n\nwith care');
    expect(expandCommandTemplate('Do the thing.', '')).toBe('Do the thing.');
  });

  it('blanks missing positionals', () => {
    expect(expandCommandTemplate('A $1 B $2', 'only')).toBe('A only B');
  });
});

describe('parseCommandInvocation', () => {
  it('parses leading /names with subpaths', () => {
    expect(parseCommandInvocation('/review src/x.ts')).toEqual({ name: 'review', input: 'src/x.ts' });
    expect(parseCommandInvocation('/deploy/staging now')).toEqual({ name: 'deploy/staging', input: 'now' });
    expect(parseCommandInvocation('/review')).toEqual({ name: 'review', input: '' });
  });

  it('rejects non-invocations', () => {
    expect(parseCommandInvocation('no slash here')).toBeNull();
    expect(parseCommandInvocation('/Has Caps')).toBeNull();
    // Path-like text parses as a candidate; resolution misses (no such
    // command file) and the caller falls through to /skill parsing.
    expect(parseCommandInvocation('/tmp/x list it')).toEqual({ name: 'tmp/x', input: 'list it' });
  });
});

describe('scanCommandFiles + expandFileCommand', () => {
  let root = '';
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = '';
  });

  function setup(): string {
    root = mkdtempSync(join(tmpdir(), 'omnipix-cmd-'));
    mkdirSync(join(root, 'commands', 'deploy'), { recursive: true });
    writeFileSync(join(root, 'commands', 'review.md'), '---\ndescription: Review.\nagent: reviewer\n---\nReview $ARGUMENTS\n');
    writeFileSync(join(root, 'commands', 'deploy', 'staging.md'), '---\ndescription: Deploy.\n---\nDeploy $1\n');
    writeFileSync(join(root, 'commands', 'broken.md'), 'no fence');
    return root;
  }

  it('finds nested commands and skips malformed files', () => {
    const found = scanCommandFiles([setup()]);
    expect(found.map(c => c.name).sort()).toEqual(['deploy/staging', 'review']);
    expect(found.find(c => c.name === 'review')).toMatchObject({ description: 'Review.', agent: 'reviewer' });
  });

  it('expands invocations and returns null for unknown names', () => {
    const dir = setup();
    expect(expandFileCommand('/review src/a.ts', [dir])).toEqual({
      goal: 'Review src/a.ts', agent: 'reviewer', model: undefined, command: 'review',
    });
    expect(expandFileCommand('/deploy/staging v2', [dir])?.goal).toBe('Deploy v2');
    expect(expandFileCommand('/nope x', [dir])).toBeNull();
    expect(expandFileCommand('plain goal', [dir])).toBeNull();
  });

  it('lets later config dirs win name clashes', () => {
    const low = mkdtempSync(join(tmpdir(), 'omnipix-cmd-low-'));
    const high = mkdtempSync(join(tmpdir(), 'omnipix-cmd-high-'));
    root = low;
    try {
      mkdirSync(join(low, 'commands'), { recursive: true });
      mkdirSync(join(high, 'commands'), { recursive: true });
      writeFileSync(join(low, 'commands', 'dupe.md'), '---\ndescription: Low.\n---\nLow $ARGUMENTS');
      writeFileSync(join(high, 'commands', 'dupe.md'), '---\ndescription: High.\n---\nHigh $ARGUMENTS');
      expect(expandFileCommand('/dupe x', [low, high])?.goal).toBe('High x');
    } finally {
      rmSync(high, { recursive: true, force: true });
    }
  });
});
