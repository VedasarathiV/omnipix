import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { initDb } from '../../db/index.js';
import { listSkills } from '../../services/agent-runtime.js';
import { parseSkillFile, scanSkillFiles } from '../../services/skill-files.js';
import { readFileSync } from 'node:fs';

// Guards the vendored superpowers pack (MIT, obra/superpowers): exact
// set, all parsing, no builtin shadowing, companion shell scripts
// present where the prose requires them.
describe('superpowers pack', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'skills', 'superpowers');

  const EXPECTED = [
    'brainstorming', 'diagnosing-superpowers', 'dispatching-parallel-agents',
    'executing-plans', 'finishing-a-development-branch', 'receiving-code-review',
    'requesting-code-review', 'subagent-driven-development', 'systematic-debugging',
    'test-driven-development', 'using-git-worktrees', 'using-superpowers',
    'verification-before-completion', 'writing-plans', 'writing-skills',
  ];

  it('ships exactly the 15 upstream skills, all parsing', () => {
    const files = scanSkillFiles([root]);
    const names = files.map(f => parseSkillFile(readFileSync(f, 'utf8')).name);
    expect(names.sort()).toEqual([...EXPECTED].sort());
  });

  it('never shadows builtins', () => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    const builtins = new Set(listSkills().filter(s => s.builtin).map(s => s.name));
    for (const name of EXPECTED) expect(builtins.has(name)).toBe(false);
  });

  it('keeps companion shell scripts next to the skills that run them', () => {
    for (const skill of ['executing-plans', 'subagent-driven-development']) {
      const dir = join(root, skill, 'scripts');
      expect(existsSync(dir)).toBe(true);
    }
  });

  it('carries no telemetry companion', () => {
    expect(existsSync(join(root, 'brainstorming', 'scripts'))).toBe(false);
    expect(existsSync(join(root, 'brainstorming', 'visual-companion.md'))).toBe(false);
  });
});
