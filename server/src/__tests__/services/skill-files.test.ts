import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseSkillFile, scanSkillFiles, serializeSkill } from '../../services/skill-files.js';

describe('skill files', () => {
  it('serializes with frontmatter, omitting enabled when true', () => {
    const out = serializeSkill({ name: 'planner', description: 'Plans.', instructions: 'Think first.', enabled: 1 });
    expect(out).toBe('---\nname: planner\ndescription: Plans.\n---\nThink first.\n');
    const off = serializeSkill({ name: 'planner', description: 'Plans.', instructions: 'Think first.', enabled: 0 });
    expect(off).toContain('enabled: false\n');
  });

  it('round-trips serialize/parse', () => {
    const content = serializeSkill({ name: 'my-skill', description: 'Does things.', instructions: 'Step 1.\nStep 2.', enabled: 1 });
    expect(parseSkillFile(content)).toEqual({
      name: 'my-skill', description: 'Does things.', instructions: 'Step 1.\nStep 2.', enabled: true,
    });
    const off = serializeSkill({ name: 'my-skill', description: 'Does things.', instructions: 'Steps.', enabled: 0 });
    expect(parseSkillFile(off).enabled).toBe(false);
  });

  it('accepts quoted values and CRLF', () => {
    const parsed = parseSkillFile('---\r\nname: "quoted-name"\r\ndescription: \'Hi there\'\r\n---\r\nBody here.\r\n');
    expect(parsed).toMatchObject({ name: 'quoted-name', description: 'Hi there', instructions: 'Body here.', enabled: true });
  });

  it('rejects malformed files with reasons', () => {
    expect(() => parseSkillFile('no fence')).toThrow('frontmatter fence');
    expect(() => parseSkillFile('---\nname: x\nno closing')).toThrow('closing ---');
    expect(() => parseSkillFile('---\nname: Bad Name!\ndescription: d\n---\nbody')).toThrow('valid name');
    expect(() => parseSkillFile('---\nname: ok\n---\nbody')).toThrow('description');
    expect(() => parseSkillFile('---\nname: ok\ndescription: d\n---\n   ')).toThrow('instructions');
    expect(() => parseSkillFile('---\nname: ok\ndescription: d\nenabled: maybe\n---\nbody')).toThrow('enabled');
    expect(() => parseSkillFile('---\nnot-a-field\ndescription: d\nname: ok\n---\nbody')).toThrow('bad frontmatter line');
  });

  it('imports Anthropic-format packs: extra fields, lists, long bodies', () => {
    const file = [
      '---',
      'name: pdf-master',
      'description: Extract tables and text from PDFs.',
      'license: MIT',
      'version: 1.1.0',
      'allowed-tools:',
      '  - Read',
      '  - Bash',
      '---',
      'Use the table tool first. ' + 'x'.repeat(30000),
    ].join('\n');
    const parsed = parseSkillFile(file);
    expect(parsed.name).toBe('pdf-master');
    expect(parsed.description).toBe('Extract tables and text from PDFs.');
    expect(parsed.instructions.length).toBeGreaterThan(30000);
    expect(parsed.enabled).toBe(true);
  });

  it('joins folded block-scalar descriptions', () => {
    const file = '---\nname: folded\ndescription: >\n  First line.\n  Second line.\n---\nbody here';
    expect(parseSkillFile(file).description).toBe('First line. Second line.');
  });
});

describe('scanSkillFiles', () => {
  let root = '';
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = '';
  });

  function setup(): string {
    root = mkdtempSync(join(tmpdir(), 'omnipix-scan-'));
    writeFileSync(join(root, 'SKILL.md'), '---\nname: top\ndescription: Top.\n---\nbody');
    mkdirSync(join(root, 'nested', 'deep'), { recursive: true });
    writeFileSync(join(root, 'nested', 'deep', 'SKILL.md'), '---\nname: deep\ndescription: Deep.\n---\nbody');
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'pkg', 'SKILL.md'), '---\nname: dep\ndescription: Dep.\n---\nbody');
    mkdirSync(join(root, '.git'), { recursive: true });
    writeFileSync(join(root, '.git', 'SKILL.md'), '---\nname: git\ndescription: Git.\n---\nbody');
    writeFileSync(join(root, 'README.md'), 'not a skill');
    return root;
  }

  it('finds nested SKILL.md files and skips deps, git, and non-skills', () => {
    const dir = setup();
    const found = scanSkillFiles([dir]);
    expect(found).toEqual([join(dir, 'SKILL.md'), join(dir, 'nested', 'deep', 'SKILL.md')].sort());
  });

  it('respects the depth cap', () => {
    const dir = setup();
    expect(scanSkillFiles([dir], 0)).toEqual([join(dir, 'SKILL.md')]);
  });

  it('skips missing roots without throwing', () => {
    const dir = setup();
    expect(scanSkillFiles([join(dir, 'nope'), dir])).toEqual(
      [join(dir, 'SKILL.md'), join(dir, 'nested', 'deep', 'SKILL.md')].sort(),
    );
  });
});
