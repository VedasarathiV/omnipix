import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyAgentPreset,
  parseAgentFile,
  resolveFileAgent,
  scanAgentFiles,
} from '../../services/file-agents.js';

describe('agent files', () => {
  it('parses presets with skills, tools, model, and planMode', () => {
    const parsed = parseAgentFile('---\ndescription: Reviews.\nskills: code-review-checklist\ntools: read_file, git_diff\nmodel: auto\nplanMode: true\n---\nNotes here.\n');
    expect(parsed).toEqual({
      description: 'Reviews.',
      skills: ['code-review-checklist'],
      tools: ['read_file', 'git_diff'],
      model: 'auto',
      planMode: true,
      notes: 'Notes here.',
    });
  });

  it('rejects missing descriptions and bad planMode', () => {
    expect(() => parseAgentFile('---\nskills: a\n---\nbody')).toThrow(/needs a description/);
    expect(() => parseAgentFile('---\ndescription: D.\nplanMode: yes\n---\nbody')).toThrow(/planMode must be/);
    expect(() => parseAgentFile('no fence')).toThrow(/frontmatter fence/);
  });

  it('merges explicit fields over presets', () => {
    expect(applyAgentPreset(
      { skills: ['a'], tools: ['read_file'], model: 'auto', planMode: true },
      { skills: ['b'] },
    )).toEqual({ skills: ['b'], tools: ['read_file'], model: 'auto', planMode: true });
    expect(applyAgentPreset({}, {})).toEqual({ skills: undefined, tools: undefined, model: undefined, planMode: undefined });
  });
});

describe('scanAgentFiles + resolveFileAgent', () => {
  let dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs = [];
  });

  function setup(): string {
    const root = mkdtempSync(join(tmpdir(), 'omnipix-agent-'));
    dirs.push(root);
    mkdirSync(join(root, 'agents'), { recursive: true });
    writeFileSync(join(root, 'agents', 'reviewer.md'), '---\ndescription: Reviewer.\nskills: code-review-checklist\ntools: read_file, git_diff\n---\n');
    writeFileSync(join(root, 'agents', 'broken.md'), 'no fence');
    return root;
  }

  it('finds agents and skips malformed files', () => {
    const found = scanAgentFiles([setup()]);
    expect(found.map(a => a.name)).toEqual(['reviewer']);
    expect(found[0]).toMatchObject({ skills: ['code-review-checklist'], tools: ['read_file', 'git_diff'] });
  });

  it('resolves by name with later dirs winning, null when unknown', () => {
    const low = mkdtempSync(join(tmpdir(), 'omnipix-aglow-'));
    const high = mkdtempSync(join(tmpdir(), 'omnipix-aghigh-'));
    dirs.push(low, high);
    mkdirSync(join(low, 'agents'), { recursive: true });
    mkdirSync(join(high, 'agent'), { recursive: true });
    writeFileSync(join(low, 'agents', 'dupe.md'), '---\ndescription: Low.\n---\n');
    writeFileSync(join(high, 'agent', 'dupe.md'), '---\ndescription: High.\n---\n');
    expect(resolveFileAgent('dupe', [low, high])?.description).toBe('High.');
    expect(resolveFileAgent('nope', [low, high])).toBeNull();
    expect(resolveFileAgent('Bad Name', [low, high])).toBeNull();
  });
});
