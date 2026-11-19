import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, initDb } from '../../db/index.js';
import { listSkills, reconcileOrphanedRuns, selectSkills, type SkillRow } from '../../services/agent-runtime.js';

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
