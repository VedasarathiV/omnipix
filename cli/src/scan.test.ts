import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from './index.js';

const token = 'dashboard-session==';
let output: string;

const SCAN = {
  id: 3, trigger: 'manual', status: 'done', workspace_count: 2,
  finding_count: 1, new_count: 1, error: null, finished_at: '2026-11-18T00:00:00Z',
};
const SETTINGS = { enabled: true, schedule: '0 3 * * *', nextRunAt: null };

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

describe('scan', () => {
  it('runs a scan and prints the summary', async () => {
    stubFetch((path, init) => {
      if (path === '/api/agents/scans' && init.method === 'POST') {
        return Response.json({ scan: SCAN, findings: [] }, { status: 201 });
      }
      throw new Error(`Unexpected request: ${path} ${init.method}`);
    });
    expect(await main(['scan', 'run'])).toBe(0);
    expect(output).toContain('scan 3 (done): 2 workspaces, 1 findings, 1 new');
  });

  it('lists scans with the job state', async () => {
    stubFetch(path => {
      if (path === '/api/agents/scans') return Response.json({ scans: [SCAN], settings: SETTINGS });
      throw new Error(`Unexpected request: ${path}`);
    });
    expect(await main(['scan', 'list'])).toBe(0);
    expect(output).toContain('scheduled scans enabled (0 3 * * *)');
    expect(output).toContain('3\tdone\tmanual\t2 workspaces\t1 findings\t1 new');
  });

  it('shows one scan with findings', async () => {
    stubFetch(path => {
      if (path === '/api/agents/scans/3') {
        return Response.json({
          scan: SCAN,
          findings: [{ id: 9, workspace: 'run-1', pattern: 'aws-key', severity: 'high', file: 'a.js', line: 1, excerpt: 'const k = "AKIA..."' }],
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    expect(await main(['scan', 'show', '3'])).toBe(0);
    expect(output).toContain('scan 3 (done): manual, 1 findings');
    expect(output).toContain('high\trun-1/a.js:1\t[aws-key]');
  });

  it('enables, disables, and configures the job', async () => {
    let posted: Record<string, unknown> = {};
    stubFetch((path, init) => {
      if (path === '/api/agents/scans-settings' && init.method === 'PATCH') {
        posted = JSON.parse(String(init.body));
        return Response.json({ settings: { ...SETTINGS, ...(posted as object) } });
      }
      throw new Error(`Unexpected request: ${path} ${init.method}`);
    });
    expect(await main(['scan', 'disable'])).toBe(0);
    expect(posted).toEqual({ enabled: false });
    expect(output).toContain('scheduled scans disabled');
    output = '';
    expect(await main(['scan', 'config', '--schedule', '*/30 * * * *'])).toBe(0);
    expect(posted).toEqual({ schedule: '*/30 * * * *' });
    expect(output).toContain('scan schedule: */30 * * * *');
  });

  it('rejects bad invocations without a request', async () => {
    const fetchSpy = vi.fn(async () => Response.json({}));
    vi.stubGlobal('fetch', fetchSpy);
    await expect(main(['scan', 'show'])).rejects.toThrow('positive scan id');
    await expect(main(['scan', 'config'])).rejects.toThrow('--schedule CRON');
    await expect(main(['scan', 'frobnicate'])).rejects.toThrow('scan run, list, show, enable, disable, or config');
    await expect(main(['scan', 'list', '--goal', 'x'])).rejects.toThrow('--goal is not supported by scan');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
