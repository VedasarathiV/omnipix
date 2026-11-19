import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from './index.js';

const token = 'dashboard-session==';
let output: string;

const RUNNING = {
  id: 3, goal: 'Say hi', model: 'auto', tools: [], skills: [], status: 'running',
  final_answer: null, error: null, steps_used: 1, prompt_tokens: 0, completion_tokens: 0,
  steps: [{ seq: 1, kind: 'thought', label: 'thinking', content: { text: 'Hmm.' } }],
};
const DONE = {
  ...RUNNING, status: 'done', final_answer: 'Hi!', steps_used: 2, prompt_tokens: 5, completion_tokens: 2,
  steps: [...RUNNING.steps, { seq: 2, kind: 'answer', label: 'final answer', content: { text: 'Hi!' } }],
};

beforeEach(() => {
  output = '';
  vi.stubEnv('OMNIPIX_DASHBOARD_TOKEN', token);
  vi.stubEnv('OMNIPIX_URL', 'http://127.0.0.1:9');
  vi.spyOn(process.stdout, 'write').mockImplementation(chunk => { output += String(chunk); return true; });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function stubFetch(handler: (path: string, init: RequestInit) => Response) {
  vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit = {}) => {
    const path = new URL(input).pathname;
    if (init.headers && (init.headers as Record<string, string>).Authorization !== `Bearer ${token}`) {
      return new Response('no', { status: 401 });
    }
    return handler(path, init);
  }));
}

describe('agent', () => {
  it('runs a goal to completion and prints the transcript', async () => {
    let polls = 0;
    stubFetch((path, init) => {
      if (path === '/api/agents/runs' && init.method === 'POST') return Response.json(RUNNING, { status: 202 });
      if (path === '/api/agents/runs/3') return Response.json(polls++ === 0 ? RUNNING : DONE);
      throw new Error(`Unexpected request: ${path}`);
    });
    const code = await main(['agent', 'run', '--goal', 'Say hi']);
    expect(code).toBe(0);
    expect(output).toContain('run 3 (running)');
    expect(output).toContain('[#1 thinking] Hmm.');
    expect(output).toContain('Hi!');
    expect(output).toContain('[done] 2 steps');
  });

  it('exits 1 when the run errors', async () => {
    stubFetch((path, init) => {
      if (path === '/api/agents/runs' && init.method === 'POST') return Response.json(RUNNING, { status: 202 });
      if (path === '/api/agents/runs/3') return Response.json({ ...RUNNING, status: 'error', error: 'boom' });
      throw new Error(`Unexpected request: ${path}`);
    });
    const code = await main(['agent', 'run', '--goal', 'Say hi']);
    expect(code).toBe(1);
    expect(output).toContain('error: boom');
  });

  it('lists, shows, and stops runs', async () => {
    stubFetch((path, init) => {
      if (path === '/api/agents/runs') return Response.json({ runs: [DONE] });
      if (path === '/api/agents/runs/3') return Response.json(DONE);
      if (path === '/api/agents/runs/3/stop') return Response.json({ ...RUNNING, status: 'stopped' });
      throw new Error(`Unexpected request: ${path} ${init.method}`);
    });
    expect(await main(['agent', 'list'])).toBe(0);
    expect(output).toContain('Say hi');
    output = '';
    expect(await main(['agent', 'show', '3'])).toBe(0);
    expect(output).toContain('final answer');
    output = '';
    expect(await main(['agent', 'stop', '3'])).toBe(0);
    expect(output).toContain('stopped');
  });

  it('rejects bad invocations without a request', async () => {
    const fetchSpy = vi.fn(async () => Response.json({}));
    vi.stubGlobal('fetch', fetchSpy);
    await expect(main(['agent', 'run'])).rejects.toThrow('--goal');
    await expect(main(['agent', 'show'])).rejects.toThrow('positive run id');
    await expect(main(['agent', 'show', 'x'])).rejects.toThrow('positive run id');
    await expect(main(['agent', 'frobnicate'])).rejects.toThrow('agent run, list, show, search, stop, approve, deny, sessions, session, session-delete, group-create, runbooks, groups, group, group-stop, group-delete, checkpoints, snapshot, or restore');
    await expect(main(['agent', 'search'])).rejects.toThrow('needs search words');
    await expect(main(['agent', 'list', '--name', 'x'])).rejects.toThrow('--name is not supported by agent');
    await expect(main(['agent', 'approve'])).rejects.toThrow('positive approval id');
    await expect(main(['agent', 'session'])).rejects.toThrow('positive session id');
    await expect(main(['agent', 'run', '--goal', 'x', '--session', 'nope'])).rejects.toThrow('--session must be a positive integer');
    await expect(main(['agent', 'group-create', '--goal', 'x'])).rejects.toThrow('--auto, --tasks JSON, or --preset NAME');
    await expect(main(['agent', 'group-create', '--goal', 'x', '--tasks', 'nope'])).rejects.toThrow('JSON array');
    await expect(main(['agent', 'group-create', '--goal', 'x', '--mode', 'mesh'])).rejects.toThrow('--mode must be');
    await expect(main(['agent', 'group-create', '--goal', 'x', '--inputs', 'nope'])).rejects.toThrow('JSON object');
    await expect(main(['agent', 'group-create', '--goal', 'x', '--preset', 'startup-mvp', '--auto'])).rejects.toThrow('only one of');
    await expect(main(['agent', 'group'])).rejects.toThrow('positive group id');
    await expect(main(['agent', 'run', '--goal', 'x', '--budget', '5'])).rejects.toThrow('--budget must be');
    await expect(main(['agent', 'run', '--goal', 'x', '--compactions', '9'])).rejects.toThrow('--compactions must be');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('exits 2 with the pending approvals when a run parks', async () => {
    stubFetch((path, init) => {
      if (path === '/api/agents/runs' && init.method === 'POST') return Response.json(RUNNING, { status: 202 });
      if (path === '/api/agents/runs/3') return Response.json({ ...RUNNING, status: 'awaiting_approval' });
      if (path === '/api/agents/approvals') {
        return Response.json({ approvals: [{ id: 11, run_id: 3, tool: 'calculator', summary: 'Calculate 2 + 2', status: 'pending' }] });
      }
      throw new Error(`Unexpected request: ${path} ${init.method}`);
    });
    const code = await main(['agent', 'run', '--goal', 'Say hi']);
    expect(code).toBe(2);
    expect(output).toContain('approval #11: Calculate 2 + 2');
    expect(output).toContain('waiting for approval');
  });

  it('approves and denies approvals', async () => {
    stubFetch((path, init) => {
      if (path === '/api/agents/approvals/11/decide' && init.method === 'POST') {
        const approved = (JSON.parse(String(init.body)) as { approved: boolean }).approved;
        return Response.json({ approval: { id: 11, status: approved ? 'approved' : 'denied' } });
      }
      throw new Error(`Unexpected request: ${path} ${init.method}`);
    });
    expect(await main(['agent', 'approve', '11'])).toBe(0);
    expect(output).toContain('approval 11: approved');
    output = '';
    expect(await main(['agent', 'deny', '11'])).toBe(0);
    expect(output).toContain('approval 11: denied');
  });

  it('lists, shows, and deletes sessions', async () => {
    let postedBody = '';
    stubFetch((path, init) => {
      if (path === '/api/agents/sessions') return Response.json({ sessions: [{ id: 5, title: 'Proj', run_count: 2, last_status: 'done' }] });
      if (path === '/api/agents/sessions/5' && (!init.method || init.method === 'GET')) {
        return Response.json({ id: 5, title: 'Proj', run_count: 1, runs: [{ id: 3, status: 'done', goal: 'Say hi' }] });
      }
      if (path === '/api/agents/sessions/5' && init.method === 'DELETE') return Response.json({ deleted: 5 });
      if (path === '/api/agents/runs' && init.method === 'POST') {
        postedBody = String(init.body);
        return Response.json(RUNNING, { status: 202 });
      }
      if (path === '/api/agents/runs/3') return Response.json(DONE);
      throw new Error(`Unexpected request: ${path} ${init.method}`);
    });
    expect(await main(['agent', 'sessions'])).toBe(0);
    expect(output).toContain('Proj');
    output = '';
    expect(await main(['agent', 'session', '5'])).toBe(0);
    expect(output).toContain('session 5: Proj (1 runs)');
    output = '';
    expect(await main(['agent', 'session-delete', '5'])).toBe(0);
    expect(output).toContain('deleted session 5');
    output = '';
    expect(await main(['agent', 'run', '--goal', 'Say hi', '--session', '5'])).toBe(0);
    expect(JSON.parse(postedBody).sessionId).toBe(5);
  });

  it('creates, lists, shows, stops, and deletes groups', async () => {
    let postedBody = '';
    const GROUP = {
      id: 2, goal: 'Ship it', status: 'running', tokens_used: 10,
      tasks: [{ id: 1, name: 'build', role: 'coder', status: 'running', error: null }],
      blackboard: [{ key: 'api', value: 'rest' }],
    };
    stubFetch((path, init) => {
      if (path === '/api/agents/groups' && init.method === 'POST') {
        postedBody = String(init.body);
        return Response.json(GROUP, { status: 202 });
      }
      if (path === '/api/agents/groups') {
        return Response.json({ groups: [{ ...GROUP, task_count: 1, done_count: 0 }] });
      }
      if (path === '/api/agents/groups/2') return Response.json(GROUP);
      if (path === '/api/agents/groups/2/stop') return Response.json({ ...GROUP, status: 'stopped' });
      if (path === '/api/agents/groups/2' && init.method === 'DELETE') return Response.json({ deleted: 2 });
      throw new Error(`Unexpected request: ${path} ${init.method}`);
    });
    expect(await main(['agent', 'group-create', '--goal', 'Ship it', '--auto', '--budget', '5000'])).toBe(0);
    expect(output).toContain('group 2 (1 tasks)');
    expect(JSON.parse(postedBody)).toMatchObject({ goal: 'Ship it', auto: true, budgetTokens: 5000 });
    output = '';
    expect(await main(['agent', 'groups'])).toBe(0);
    expect(output).toContain('0/1\tShip it');
    output = '';
    expect(await main(['agent', 'group', '2'])).toBe(0);
    expect(output).toContain('build (coder)');
    expect(output).toContain('board api');
    output = '';
    expect(await main(['agent', 'group-stop', '2'])).toBe(0);
    expect(output).toContain('group 2: stopped');
    output = '';
    expect(await main(['agent', 'group-delete', '2'])).toBe(0);
    expect(output).toContain('deleted group 2');
  });

  it('creates hierarchical groups and shows the mode', async () => {
    let postedBody = '';
    stubFetch((path, init) => {
      if (path === '/api/agents/groups' && init.method === 'POST') {
        postedBody = String(init.body);
        return Response.json({ id: 3, tasks: [] }, { status: 202 });
      }
      if (path === '/api/agents/groups/3') {
        return Response.json({
          id: 3, goal: 'Ship it', status: 'running', tokens_used: 5,
          mode: 'hierarchical', manager_decisions: 2, tasks: [], blackboard: [],
        });
      }
      throw new Error(`Unexpected request: ${path} ${init.method}`);
    });
    expect(await main(['agent', 'group-create', '--goal', 'Ship it', '--mode', 'hierarchical'])).toBe(0);
    expect(JSON.parse(postedBody)).toMatchObject({ goal: 'Ship it', mode: 'hierarchical' });
    expect(output).toContain('group 3 (0 tasks)');
    output = '';
    expect(await main(['agent', 'group', '3'])).toBe(0);
    expect(output).toContain('mode: hierarchical (2 manager decisions)');
  });

  it('lists runbooks and creates preset groups', async () => {
    let postedBody = '';
    stubFetch((path, init) => {
      if (path === '/api/agents/runbooks') {
        return Response.json({ runbooks: [{ name: 'startup-mvp', description: 'Ship it', tasks: [{ name: 'spec' }, { name: 'build' }] }] });
      }
      if (path === '/api/agents/groups' && init.method === 'POST') {
        postedBody = String(init.body);
        return Response.json({ id: 4, tasks: [{ id: 1 }, { id: 2 }] }, { status: 202 });
      }
      throw new Error(`Unexpected request: ${path} ${init.method}`);
    });
    expect(await main(['agent', 'runbooks'])).toBe(0);
    expect(output).toContain('startup-mvp\tspec -> build');
    output = '';
    expect(await main(['agent', 'group-create', '--goal', 'Ship it', '--preset', 'startup-mvp'])).toBe(0);
    expect(JSON.parse(postedBody)).toMatchObject({ preset: 'startup-mvp' });
    expect(output).toContain('group 4 (2 tasks)');
  });

  it('shows task contracts and handoffs in group detail', async () => {
    stubFetch(path => {
      if (path === '/api/agents/groups/2') {
        return Response.json({
          id: 2, goal: 'Ship it', status: 'done', tokens_used: 10,
          tasks: [
            {
              id: 1, name: 'build', role: 'coder', status: 'done', error: null,
              expected_output: 'Working code.', inputs: [],
              handoff: { summary: 'Built ok', outputs: { 'api-shape': 'REST' } },
              verdict: { pass: true, reason: 'All criteria met.', kind: 'llm_judge' },
              output_json: 1, output_file: 'out/result.json',
            },
            {
              id: 2, name: 'check', role: 'reviewer', status: 'done', error: null,
              expected_output: 'A review.', inputs: [{ name: 'spec', from: 1 }],
              handoff: { summary: 'Looks good', outputs: {} },
            },
          ],
          blackboard: [],
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    expect(await main(['agent', 'group', '2'])).toBe(0);
    expect(output).toContain('expects: Working code.');
    expect(output).toContain('<- spec from build');
    expect(output).toContain('handoff: api-shape');
    expect(output).toContain('verdict: PASS — All criteria met.');
    expect(output).toContain('output: JSON -> out/result.json');
  });

  it('lists, snapshots, and restores checkpoints', async () => {
    const CPS = [
      { id: 5, run_id: 3, seq: 2, label: 'before write_file a.txt', created_at: '2026-11-18T00:00:00Z' },
      { id: 4, run_id: 3, seq: 1, label: '', created_at: '2026-11-17T23:59:00Z' },
    ];
    stubFetch((path, init) => {
      if (path === '/api/agents/runs/3/checkpoints' && (init.method === 'GET' || !init.method)) {
        return Response.json({ checkpoints: CPS });
      }
      if (path === '/api/agents/runs/3/checkpoints' && init.method === 'POST') {
        return Response.json({ checkpoint: { id: 6, run_id: 3, seq: 2, label: '', created_at: 'now' } }, { status: 201 });
      }
      if (path === '/api/agents/checkpoints/5/restore' && init.method === 'POST') {
        return Response.json({ restored: 5, run: { ...DONE, id: 3 } });
      }
      throw new Error(`Unexpected request: ${path} ${init.method}`);
    });
    expect(await main(['agent', 'checkpoints', '3'])).toBe(0);
    expect(output).toContain('5\tstep 2');
    expect(output).toContain('before write_file a.txt');
    output = '';
    expect(await main(['agent', 'snapshot', '3'])).toBe(0);
    expect(output).toContain('checkpoint 6 for run 3');
    output = '';
    expect(await main(['agent', 'restore', '5'])).toBe(0);
    expect(output).toContain('restored checkpoint 5; run 3 is done');
  });

  it('passes --plan through and shows planned runs', async () => {
    let postedBody = '';
    const PLANNED = {
      ...DONE,
      plan_mode: 1,
      steps: [{ seq: 1, kind: 'plan', label: 'plan', content: { text: '1. Say hi.' } }],
    };
    stubFetch((path, init) => {
      if (path === '/api/agents/runs' && init.method === 'POST') {
        postedBody = String(init.body);
        return Response.json({ ...RUNNING, plan_mode: 1, steps: [] }, { status: 202 });
      }
      if (path === '/api/agents/runs/3') return Response.json(PLANNED);
      throw new Error(`Unexpected request: ${path} ${init.method}`);
    });
    expect(await main(['agent', 'run', '--goal', 'Say hi', '--plan'])).toBe(0);
    expect(JSON.parse(postedBody).planMode).toBe(true);
    expect(output).toContain('[#1 plan] 1. Say hi.');
    output = '';
    expect(await main(['agent', 'show', '3'])).toBe(0);
    expect(output).toContain('[plan mode]');
  });

  it('flags auto-approved runs in show', async () => {
    stubFetch(path => {
      if (path === '/api/agents/runs/5') {
        return Response.json({ ...DONE, id: 5, auto_approve: 1, steps: [] });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    expect(await main(['agent', 'show', '5'])).toBe(0);
    expect(output).toContain('[auto-approved]');
  });

  it('passes --compactions through and prints compact steps', async () => {
    let postedBody = '';
    stubFetch((path, init) => {
      if (path === '/api/agents/runs' && init.method === 'POST') {
        postedBody = String(init.body);
        return Response.json({ ...RUNNING, steps: [] }, { status: 202 });
      }
      if (path === '/api/agents/runs/3') {
        return Response.json({
          ...DONE,
          steps: [{ seq: 1, kind: 'compact', label: 'compact', content: { cycle: 1, trigger: 'overflow', summary: 'Did math.' } }],
        });
      }
      throw new Error(`Unexpected request: ${path} ${init.method}`);
    });
    expect(await main(['agent', 'run', '--goal', 'Long task', '--compactions', '2'])).toBe(0);
    expect(JSON.parse(postedBody).compactions).toBe(2);
    expect(output).toContain('[#1 compact] context compacted (cycle 1, overflow): Did math.');
  });

  it('searches past runs', async () => {
    stubFetch(path => {
      if (path === '/api/agents/runs/search') {
        return Response.json({ runs: [{ id: 9, goal: 'Fix login loop', status: 'done' }] });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    expect(await main(['agent', 'search', 'login', 'loop'])).toBe(0);
    expect(output).toContain('9\tdone\tFix login loop');
  });

  it('shows the parent link for child runs', async () => {
    stubFetch(path => {
      if (path === '/api/agents/runs/4') {
        return Response.json({ ...DONE, id: 4, parent_run_id: 3, steps: [] });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    expect(await main(['agent', 'show', '4'])).toBe(0);
    expect(output).toContain('[child of 3]');
  });

  it('rejects bad checkpoint invocations without a request', async () => {
    const fetchSpy = vi.fn(async () => Response.json({}));
    vi.stubGlobal('fetch', fetchSpy);
    await expect(main(['agent', 'checkpoints'])).rejects.toThrow('needs a positive run id');
    await expect(main(['agent', 'restore', 'x'])).rejects.toThrow('needs a positive checkpoint id');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('skills', () => {
  const SKILLS = [
    { name: 'planner', description: 'Plan', enabled: 1, builtin: 1 },
    { name: 'mine', description: 'Custom', enabled: 0, builtin: 0 },
  ];

  it('lists, creates, toggles, and deletes skills', async () => {
    stubFetch((path, init) => {
      if (path === '/api/skills' && (init.method === 'GET' || !init.method)) return Response.json({ skills: SKILLS });
      if (path === '/api/skills' && init.method === 'POST') {
        return Response.json({ skill: { name: 'newbie', enabled: 1, builtin: 0 } }, { status: 201 });
      }
      if (path === '/api/skills/mine' && init.method === 'PATCH') {
        return Response.json({ skill: { ...SKILLS[1], enabled: 1 } });
      }
      if (path === '/api/skills/mine' && init.method === 'DELETE') return Response.json({ deleted: 'mine' });
      throw new Error(`Unexpected request: ${path} ${init.method}`);
    });
    expect(await main(['skills', 'list'])).toBe(0);
    expect(output).toContain('planner\tenabled\tbuilt-in');
    output = '';
    expect(await main(['skills', 'create', '--name', 'newbie', '--description', 'd', '--instructions', 'i'])).toBe(0);
    expect(output).toContain('created newbie');
    output = '';
    expect(await main(['skills', 'enable', 'mine'])).toBe(0);
    expect(output).toContain('mine: enabled');
    output = '';
    expect(await main(['skills', 'delete', 'mine'])).toBe(0);
    expect(output).toContain('deleted mine');
  });

  it('passes --bundle members on create', async () => {
    let posted: unknown;
    stubFetch((path, init) => {
      if (path === '/api/skills' && init.method === 'POST') {
        posted = JSON.parse(init.body as string);
        return Response.json({ skill: { name: 'pack', enabled: 1, builtin: 0 } }, { status: 201 });
      }
      throw new Error(`Unexpected request: ${path} ${init.method}`);
    });
    expect(await main(['skills', 'create', '--name', 'pack', '--description', 'd', '--instructions', 'i', '--bundle', 'planner, critic'])).toBe(0);
    expect(posted).toMatchObject({ name: 'pack', bundle: ['planner', 'critic'] });
  });

  it('rejects bad invocations without a request', async () => {
    const fetchSpy = vi.fn(async () => Response.json({}));
    vi.stubGlobal('fetch', fetchSpy);
    await expect(main(['skills', 'create', '--name', 'x'])).rejects.toThrow('--name, --description, and --instructions');
    await expect(main(['skills', 'enable'])).rejects.toThrow('needs a skill name');
    await expect(main(['skills', 'export'])).rejects.toThrow('needs a skill name');
    await expect(main(['skills', 'import'])).rejects.toThrow('needs a file path');
    await expect(main(['skills', 'accept'])).rejects.toThrow('positive proposal id');
    await expect(main(['skills', 'discard', 'x'])).rejects.toThrow('positive proposal id');
    await expect(main(['skills', 'import', '/no/such/file.md'])).rejects.toThrow('Cannot read skill file');
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const empty = join(mkdtempSync(join(tmpdir(), 'omnipix-skill-')), 'empty.md');
    writeFileSync(empty, '  \n');
    await expect(main(['skills', 'import', empty])).rejects.toThrow('Skill file is empty');
    await expect(main(['skills', 'list', '--goal', 'x'])).rejects.toThrow('--goal is not supported by skills');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('exports and imports skills as files', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'omnipix-skill-'));
    const file = join(dir, 'newbie.skill.md');
    writeFileSync(file, '---\nname: newbie\ndescription: New.\n---\nDo it.');
    try {
      stubFetch((path, init) => {
        if (path === '/api/skills/planner/export') {
          return Response.json({ name: 'planner', content: '---\nname: planner\n---\nPlan.' });
        }
        if (path === '/api/skills/import' && init.method === 'POST') {
          return Response.json({ skill: { name: 'newbie', enabled: 1, builtin: 0 } }, { status: 201 });
        }
        throw new Error(`Unexpected request: ${path} ${init.method}`);
      });
      expect(await main(['skills', 'export', 'planner'])).toBe(0);
      expect(output).toContain('name: planner');
      output = '';
      expect(await main(['skills', 'import', file])).toBe(0);
      expect(output).toContain('imported newbie');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lists, accepts, and discards proposals', async () => {
    stubFetch((path, init) => {
      if (path === '/api/agents/proposals') {
        return Response.json({ proposals: [{ id: 7, kind: 'skill', title: 'explorer', source_run_id: 3 }] });
      }
      if (path === '/api/agents/proposals/7/accept' && init.method === 'POST') {
        return Response.json({ proposal: { id: 7, title: 'explorer', status: 'accepted' } });
      }
      if (path === '/api/agents/proposals/7/discard' && init.method === 'POST') {
        return Response.json({ proposal: { id: 7, title: 'explorer', status: 'discarded' } });
      }
      throw new Error(`Unexpected request: ${path} ${init.method}`);
    });
    expect(await main(['skills', 'proposals'])).toBe(0);
    expect(output).toContain('7\tskill\texplorer\trun #3');
    output = '';
    expect(await main(['skills', 'accept', '7'])).toBe(0);
    expect(output).toContain('proposal 7 (explorer): accepted');
    output = '';
    expect(await main(['skills', 'discard', '7'])).toBe(0);
    expect(output).toContain('proposal 7 (explorer): discarded');
  });

  it('requires a dashboard token', async () => {
    vi.stubEnv('OMNIPIX_DASHBOARD_TOKEN', '');
    const fetchSpy = vi.fn(async () => Response.json({}));
    vi.stubGlobal('fetch', fetchSpy);
    await expect(main(['skills', 'list'])).rejects.toThrow('dashboard session token');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('hooks', () => {
  const HOOKS = [
    { id: 1, name: 'veto-shell', event: 'pre_tool', tool_filter: 'shell_exec', command: 'exit 1', timeout_ms: 30000, enabled: 1 },
  ];

  it('lists, creates, toggles, and deletes hooks', async () => {
    let posted: Record<string, unknown> = {};
    stubFetch((path, init) => {
      if (path === '/api/agents/hooks' && (!init.method || init.method === 'GET')) return Response.json({ hooks: HOOKS });
      if (path === '/api/agents/hooks' && init.method === 'POST') {
        posted = JSON.parse(String(init.body));
        return Response.json({ hook: { id: 2, name: 'watch', event: 'post_tool' } }, { status: 201 });
      }
      if (path === '/api/agents/hooks/1' && init.method === 'PATCH') {
        return Response.json({ hook: { ...HOOKS[0], enabled: 0 } });
      }
      if (path === '/api/agents/hooks/1' && init.method === 'DELETE') return Response.json({ deleted: 1 });
      throw new Error(`Unexpected request: ${path} ${init.method}`);
    });
    expect(await main(['hooks', 'list'])).toBe(0);
    expect(output).toContain('veto-shell');
    output = '';
    expect(await main(['hooks', 'create', '--name', 'watch', '--event', 'post', '--command', 'exit 0', '--tool', 'calculator'])).toBe(0);
    expect(output).toContain('created hook 2 (watch)');
    expect(posted).toMatchObject({ name: 'watch', event: 'post_tool', toolFilter: 'calculator', command: 'exit 0' });
    output = '';
    expect(await main(['hooks', 'disable', '1'])).toBe(0);
    expect(output).toContain('hook 1 (veto-shell): disabled');
    output = '';
    expect(await main(['hooks', 'delete', '1'])).toBe(0);
    expect(output).toContain('deleted hook 1');
  });

  it('rejects bad invocations without a request', async () => {
    const fetchSpy = vi.fn(async () => Response.json({}));
    vi.stubGlobal('fetch', fetchSpy);
    await expect(main(['hooks', 'create', '--name', 'x'])).rejects.toThrow('--name, --event pre|post, and --command');
    await expect(main(['hooks', 'create', '--name', 'x', '--event', 'maybe', '--command', 'exit 0'])).rejects.toThrow('--name, --event pre|post, and --command');
    await expect(main(['hooks', 'enable'])).rejects.toThrow('positive hook id');
    await expect(main(['hooks', 'list', '--goal', 'x'])).rejects.toThrow('--goal is not supported by hooks');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
