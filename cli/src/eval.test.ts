import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from './index.js';

const token = 'dashboard-session==';
let output: string;

const RUNNING = {
  id: 2, suite: 'safety-basics', models: ['model-a'], status: 'running',
  error: null, results: [],
};
const DONE = {
  ...RUNNING, status: 'done',
  results: [{ model: 'model-a', displayName: 'Model A', platform: 'groq', passed: 3, total: 4 }],
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

describe('eval', () => {
  it('lists suites', async () => {
    stubFetch(path => {
      if (path === '/api/arena/suites') {
        return Response.json({ suites: [{ name: 'safety-basics', description: 'Safety.', items: [{}, {}], builtin: 1 }] });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    expect(await main(['eval', 'suites'])).toBe(0);
    expect(output).toContain('safety-basics\t2 checks\tbuilt-in');
  });

  it('lists verify recipes', async () => {
    stubFetch(path => {
      if (path === '/api/arena/verify-recipes') {
        return Response.json({ recipes: [{ name: 'pytest', description: 'Run pytest.', commands: ['python3 -m pytest -q'] }] });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    expect(await main(['eval', 'recipes'])).toBe(0);
    expect(output).toContain('pytest\tpython3 -m pytest -q');
  });

  it('runs a suite to completion and prints scores', async () => {
    let polls = 0;
    stubFetch((path, init) => {
      if (path === '/api/arena/evals' && init.method === 'POST') return Response.json(RUNNING, { status: 202 });
      if (path === '/api/arena/evals/2') return Response.json(polls++ === 0 ? RUNNING : DONE);
      throw new Error(`Unexpected request: ${path}`);
    });
    const code = await main(['eval', 'run', '--suite', 'safety-basics', '--models', 'model-a']);
    expect(code).toBe(0);
    expect(output).toContain('eval 2 (running)');
    expect(output).toContain('Model A\t3/4');
  });

  it('lists evals, shows one, and prints scorecards', async () => {
    stubFetch(path => {
      if (path === '/api/arena/evals') return Response.json({ evals: [DONE] });
      if (path === '/api/arena/evals/2') return Response.json(DONE);
      if (path === '/api/arena/scorecards') {
        return Response.json({ scorecards: [{ displayName: 'Model A', passRate: 0.75, passed: 3, total: 4, runs: 1 }] });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    expect(await main(['eval', 'list'])).toBe(0);
    expect(output).toContain('safety-basics');
    output = '';
    expect(await main(['eval', 'show', '2'])).toBe(0);
    expect(output).toContain('Model A\t3/4');
    output = '';
    expect(await main(['eval', 'scorecards'])).toBe(0);
    expect(output).toContain('Model A\t75.0%');
  });

  it('shows per-item results with agent links', async () => {
    const DETAILED = {
      ...DONE,
      results: [{
        model: 'model-a', displayName: 'Model A', platform: 'groq', passed: 1, total: 2,
        items: [
          { id: 'world', pass: true, agentRunId: 42, agentStatus: 'done', checks: [{ type: 'shell', pass: true, detail: 'cat world.txt: exit 0' }] },
          { id: 'flat', pass: false, error: 'Model unavailable.', checks: [] },
        ],
      }],
    };
    stubFetch(path => {
      if (path === '/api/arena/evals/2') return Response.json(DETAILED);
      throw new Error(`Unexpected request: ${path}`);
    });
    expect(await main(['eval', 'show', '2'])).toBe(0);
    expect(output).toContain('PASS\tworld agent #42 (done)\tcat world.txt: exit 0');
    expect(output).toContain('FAIL\tflat\tModel unavailable.');
  });

  it('rejects bad invocations without a request', async () => {
    const fetchSpy = vi.fn(async () => Response.json({}));
    vi.stubGlobal('fetch', fetchSpy);
    await expect(main(['eval', 'run'])).rejects.toThrow('--suite');
    await expect(main(['eval', 'run', '--suite', 's'])).rejects.toThrow('--models');
    await expect(main(['eval', 'show'])).rejects.toThrow('positive eval id');
    await expect(main(['eval', 'frobnicate'])).rejects.toThrow('eval suites, recipes, run, list, show, or scorecards');
    await expect(main(['eval', 'list', '--goal', 'x'])).rejects.toThrow('--goal is not supported by eval');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
