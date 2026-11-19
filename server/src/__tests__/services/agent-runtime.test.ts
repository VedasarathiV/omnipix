import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDb, initDb } from '../../db/index.js';
import { runWorkspace } from '../../lib/workspace.js';
import { listSkills, reconcileOrphanedRuns, repoConventions, selectSkills, skillPromptBlock, type SkillRow } from '../../services/agent-runtime.js';

const SKILLS: SkillRow[] = [
  { name: 'planner', description: 'Break a goal into steps', instructions: 'list steps with tools', enabled: 1, builtin: 1 },
  { name: 'researcher', description: 'Answer from searched sources', instructions: 'use web search and cite pages', enabled: 1, builtin: 1 },
  { name: 'disabled-one', description: 'Never picked', instructions: 'search search search', enabled: 0, builtin: 0 },
];

describe('selectSkills', () => {
  it('honors explicit names and drops unknown/disabled ones', () => {
    expect(selectSkills('anything', SKILLS, ['researcher', 'nope', 'disabled-one']).map(s => s.name))
      .toEqual(['researcher']);
  });

  it('scores by keyword overlap and caps at two', () => {
    const picked = selectSkills('search the web for sources and cite the pages', SKILLS);
    expect(picked.map(s => s.name)).toEqual(['researcher']);
  });

  it('needs at least two overlapping words', () => {
    expect(selectSkills('do the thing now', SKILLS)).toEqual([]);
    expect(selectSkills('unknown words here', SKILLS)).toEqual([]);
  });

  it('ignores short words', () => {
    expect(selectSkills('a an to of in', SKILLS)).toEqual([]);
  });

  it('weights name over description over instructions', () => {
    // 'planner' in the goal names the discipline: picked on one word.
    expect(selectSkills('planner needed', SKILLS).map(s => s.name)).toEqual(['planner']);
    // One instruction-only word is weak evidence: not picked.
    expect(selectSkills('zzzz tools yyyy', SKILLS)).toEqual([]);
  });

  it('loads repo conventions from CLAUDE.md and AGENTS.md, capped', () => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omnipix-conventions-'));
    process.env.OMNIPIX_WORKSPACE_ROOT = tmp;
    try {
      const ws = runWorkspace(1);
      expect(repoConventions(1)).toBe('');
      fs.writeFileSync(path.join(ws, 'CLAUDE.md'), 'Use tabs.');
      fs.writeFileSync(path.join(ws, 'AGENTS.md'), 'x'.repeat(9000));
      const out = repoConventions(1);
      expect(out).toContain('Use tabs.');
      expect(out).toContain('Repository conventions');
      expect(out.length).toBeLessThanOrEqual(8100);
    } finally {
      delete process.env.OMNIPIX_WORKSPACE_ROOT;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('truncates long instructions on inject with a marker', () => {
    const long = { name: 'big', description: 'd', instructions: 'x'.repeat(7000), enabled: 1, builtin: 0 };
    const block = skillPromptBlock(long);
    expect(block).toContain('## big');
    expect(block).toContain('find_skill');
    expect(block.length).toBeLessThan(7000);
    expect(skillPromptBlock({ ...long, instructions: 'short' })).toBe('## big\nshort');
  });
});

describe('seeded skills', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
  });

  it('ships core skills plus the persona roster, all enabled', () => {
    const skills = listSkills();
    expect(skills.filter(s => s.builtin).map(s => s.name).sort())
      .toEqual([
        'accessibility-auditor', 'api-tester', 'appsec-engineer', 'backend-architect',
        'code-reviewer', 'critic', 'database-optimizer', 'devops-automator',
        'frontend-developer', 'incident-responder', 'penetration-tester', 'planner',
        'prompt-engineer', 'reality-checker', 'researcher', 'sre',
        'technical-writer', 'test-automation-engineer',
      ]);
    expect(skills.every(s => s.enabled)).toBe(true);
    expect(listSkills(true)).toHaveLength(skills.length);
  });
});

describe('reconcileOrphanedRuns', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
  });

  it('fails runs left running with no live driver, and is idempotent', () => {
    const row = getDb().prepare(
      "INSERT INTO agent_runs (goal, model, status) VALUES ('stuck', 'auto', 'running') RETURNING id",
    ).get() as { id: number };
    expect(reconcileOrphanedRuns()).toBe(1);
    expect(getDb().prepare('SELECT status, error FROM agent_runs WHERE id = ?').get(row.id)).toMatchObject({
      status: 'error',
      error: expect.stringContaining('restarted'),
    });
    expect(reconcileOrphanedRuns()).toBe(0);
  });

  it('leaves terminal runs alone', () => {
    getDb().prepare("INSERT INTO agent_runs (goal, model, status) VALUES ('done', 'auto', 'done')").run();
    expect(reconcileOrphanedRuns()).toBe(0);
  });
});
