import { beforeEach, describe, expect, it } from 'vitest';
import { initDb, getDb } from '../../db/index.js';
import { __testing, agentToolByName, AGENT_TOOLS } from '../../services/agent-tools.js';

const { evaluateExpression, isBlockedFetchUrl } = __testing;

describe('calculator', () => {
  it.each([
    ['2+2', 4],
    ['(12 + 8) / 4', 5],
    ['2 * 3 + 4 * 5', 26],
    ['2^10', 1024],
    ['-3 + 2', -1],
    ['10 % 3', 1],
    ['1.5 * 2', 3],
  ])('%s = %s', (expr, expected) => {
    expect(evaluateExpression(expr)).toBe(expected);
  });

  it.each(['', '2+', '(2', '2/0', 'a+1', 'process.exit()', '2**3'])('rejects %s', (expr) => {
    expect(() => evaluateExpression(expr)).toThrow();
  });
});

describe('fetch_url guards', () => {
  it.each([
    'http://localhost:8080/x',
    'http://127.0.0.1/',
    'http://10.0.0.5/',
    'http://192.168.1.1/',
    'http://172.16.0.9/',
    'http://169.254.1.1/',
    'http://[::1]/',
    'file:///etc/passwd',
    'not-a-url',
  ])('blocks %s', (url) => {
    expect(isBlockedFetchUrl(url)).toBeTruthy();
  });

  it.each(['https://example.com/page', 'http://example.com/'])('allows %s', (url) => {
    expect(isBlockedFetchUrl(url)).toBeNull();
  });
});

describe('tool registry', () => {
  it('exposes the read, workspace, blackboard, memory, git, delegate, and docs tools with function definitions', () => {
    expect(AGENT_TOOLS.map(t => t.name).sort()).toEqual(
      ['blackboard_read', 'blackboard_write', 'calculator', 'current_time', 'delegate', 'edit_file', 'fetch_url', 'find_skill', 'git_branch', 'git_clone', 'git_commit', 'git_diff', 'git_log', 'git_status', 'grep_search', 'memory_read', 'memory_write', 'read_file', 'recall_docs', 'recall_memory', 'remember', 'run_check', 'shell_exec', 'web_search', 'write_file'],
    );
    for (const tool of AGENT_TOOLS) {
      expect(tool.definition.type).toBe('function');
      expect(tool.definition.function.name).toBe(tool.name);
    }
  });

  it('looks tools up by name', () => {
    expect(agentToolByName('calculator')).toBeDefined();
    expect(agentToolByName('shell_exec')).toBeDefined();
    expect(agentToolByName('nuke_everything')).toBeUndefined();
  });
});

describe('recall_docs', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    getDb().prepare(
      'INSERT INTO doc_chunks (project_key, source_url, title, chunk_index, section, content) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('acme', 'https://docs.test/g', 'Guide', 0, 'Auth', 'Use bearer tokens for auth.');
  });

  it('searches the run project by default', async () => {
    getDb().prepare(
      "INSERT INTO agent_runs (goal, model, tools_json, skills_json, status, project_key) VALUES ('g', 'auto', '[]', '[]', 'running', 'acme')",
    ).run();
    const tool = agentToolByName('recall_docs')!;
    const out = await tool.execute({ query: 'bearer tokens' }, { runId: 1 });
    expect(out).toContain('bearer tokens');
    expect(out).toContain('Relevant docs');
    expect(await tool.execute({ query: 'nothing matches this' }, { runId: 1 })).toContain('no doc chunks match');
  });

  it('needs an explicit project when the run has none', async () => {
    getDb().prepare(
      "INSERT INTO agent_runs (goal, model, tools_json, skills_json, status, project_key) VALUES ('g', 'auto', '[]', '[]', 'running', '')",
    ).run();
    const tool = agentToolByName('recall_docs')!;
    expect(await tool.execute({ query: 'bearer' }, { runId: 1 })).toContain('no project');
    expect(await tool.execute({ query: 'bearer', project: 'acme' }, { runId: 1 })).toContain('bearer tokens');
  });
});

describe('find_skill', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    getDb().prepare(
      "INSERT INTO agent_runs (goal, model, tools_json, skills_json, status, project_key) VALUES ('g', 'auto', '[]', '[]', 'running', '')",
    ).run();
  });

  it('searches the library by keyword with full text on demand', async () => {
    const tool = agentToolByName('find_skill')!;
    const names = await tool.execute({ query: 'penetration' }, { runId: 1 });
    expect(names).toContain('penetration-tester');
    expect(names).not.toContain('## ');
    const full = await tool.execute({ query: 'penetration', full: true }, { runId: 1 });
    expect(full.length).toBeGreaterThan(names.length);
    expect(await tool.execute({ query: 'zzz-no-such-skill' }, { runId: 1 })).toContain('no skills match');
  });
});

describe('remember', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    getDb().prepare(
      "INSERT INTO agent_runs (goal, model, tools_json, skills_json, status, project_key) VALUES ('g', 'auto', '[]', '[]', 'running', '')",
    ).run();
  });

  it('quarantines durable writes as proposals instead of writing direct', async () => {
    const tool = agentToolByName('remember')!;
    const out = await tool.execute({ key: 'commit-style', value: 'Short subjects.' }, { runId: 1 });
    expect(out).toContain('queued for operator review');
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM memories').get()).toMatchObject({ n: 0 });
    const proposal = getDb().prepare("SELECT * FROM learning_proposals WHERE kind = 'memory'").get() as { title: string; status: string };
    expect(proposal).toMatchObject({ title: 'commit-style', status: 'pending' });
  });
});
