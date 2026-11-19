import { describe, expect, it } from 'vitest';
import { parseSkillFile, serializeSkill } from '../../services/skill-files.js';

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
});
