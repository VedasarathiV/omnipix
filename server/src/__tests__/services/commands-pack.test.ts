import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AGENT_TOOL_NAMES } from '../../services/agent-runtime.js';
import { expandCommandTemplate, scanCommandFiles } from '../../services/commands.js';
import { resolveFileAgent, scanAgentFiles } from '../../services/file-agents.js';

// Guards the repo's seed commands + agents: everything parses, names
// are the documented set, presets reference real tools/skills shapes,
// and command templates expand.
describe('commands + agents pack', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

  it('ships the documented commands, all expanding', () => {
    const cmds = scanCommandFiles([root]);
    expect(cmds.map(c => c.name).sort()).toEqual(['review', 'tests']);
    const review = cmds.find(c => c.name === 'review');
    expect(expandCommandTemplate(review!.template, 'src/a.ts')).toContain('src/a.ts');
    expect(review!.agent).toBe('reviewer');
  });

  it('ships the documented agents with valid tool presets', () => {
    const agents = scanAgentFiles([root]);
    expect(agents.map(a => a.name).sort()).toEqual(['coder', 'reviewer']);
    const tools = new Set(AGENT_TOOL_NAMES);
    for (const agent of agents) {
      expect(agent.skills?.length ?? 0).toBeGreaterThan(0);
      for (const tool of agent.tools ?? []) expect(tools.has(tool)).toBe(true);
    }
    expect(resolveFileAgent('reviewer', [root])?.tools).toContain('git_diff');
    expect(resolveFileAgent('coder', [root])?.tools).toContain('run_check');
  });

  it('command agents resolve to shipped presets', () => {
    const names = new Set(scanAgentFiles([root]).map(a => a.name));
    for (const cmd of scanCommandFiles([root])) {
      if (cmd.agent) expect(names.has(cmd.agent)).toBe(true);
    }
  });
});
