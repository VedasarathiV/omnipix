import { existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { initDb } from '../../db/index.js';
import { listSkills } from '../../services/agent-runtime.js';
import { parseSkillFile, scanSkillFiles } from '../../services/skill-files.js';
import { readFileSync } from 'node:fs';

// Guards the repo's community skills pack: every SKILL.md must parse,
// names stay unique, and none shadow a builtin seed (file skills never
// override builtins, so a collision would silently never load).
describe('skills pack', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'skills');

  it('ships exactly the documented skills, all parsing', () => {
    // Depth 1: top-level pack only (nested packs like superpowers/ have
    // their own validators).
    const files = scanSkillFiles([root], 1);
    const names = files.map(f => parseSkillFile(readFileSync(f, 'utf8')).name);
    expect(names.sort()).toEqual([
      'code-review-checklist', 'competitor-analysis', 'doc-writer',
      'email-drafter', 'issue-triager', 'job-app', 'meeting-notes',
      'news-brief', 'recipe-suggester', 'resume-parser', 'social-writer',
      'test-generator', 'travel-planner', 'web-researcher',
    ]);
  });

  it('names are unique, valid, and never shadow builtins', () => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    const builtins = new Set(listSkills().filter(s => s.builtin).map(s => s.name));
    const files = scanSkillFiles([root]);
    const names = files.map(f => parseSkillFile(readFileSync(f, 'utf8')).name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      expect(builtins.has(name)).toBe(false);
    }
  });

  it('every skill lives in its own directory with a README-covered name', () => {
    const dirs = readdirSync(root, { withFileTypes: true })
      .filter(e => e.isDirectory() && existsSync(join(root, e.name, 'SKILL.md')))
      .map(e => e.name)
      .sort();
    const files = scanSkillFiles([root], 1);
    const names = files.map(f => parseSkillFile(readFileSync(f, 'utf8')).name).sort();
    expect(dirs).toEqual(names);
  });
});
