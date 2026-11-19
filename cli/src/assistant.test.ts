import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from './index.js';

const token = 'dashboard-session==';
let output: string;

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

describe('memory', () => {
  it('lists, adds, and deletes memories', async () => {
    let postedBody = '';
    stubFetch((path, init) => {
      if (path === '/api/memories' && (!init.method || init.method === 'GET')) {
        return Response.json({ memories: [{ id: 1, scope: 'user', project_key: '', key: 'style', value: 'tabs', score: 0.55 }] });
      }
      if (path === '/api/memories' && init.method === 'POST') {
        postedBody = String(init.body);
        return Response.json({ memory: { id: 2, key: 'tz', value: 'UTC+8' }, redactions: 0 }, { status: 201 });
      }
      if (path === '/api/memories/1' && init.method === 'DELETE') return Response.json({ deleted: 1 });
      throw new Error(`Unexpected request: ${path} ${init.method}`);
    });
    expect(await main(['memory', 'list'])).toBe(0);
    expect(output).toContain('style\ttabs\t0.55');
    output = '';
    expect(await main(['memory', 'add', '--key', 'tz', '--value', 'UTC+8'])).toBe(0);
    expect(output).toContain('remembered tz (id 2)');
    expect(JSON.parse(postedBody)).toMatchObject({ key: 'tz', value: 'UTC+8' });
    output = '';
    expect(await main(['memory', 'delete', '1'])).toBe(0);
    expect(output).toContain('forgot memory 1');
  });

  it('ingests, lists, and removes docs', async () => {
    stubFetch((path, init) => {
      if (path === '/api/memories/ingest' && init.method === 'POST') {
        return Response.json({ doc: { title: 'Guide', chunks: 4, replaced: false } }, { status: 201 });
      }
      if (path === '/api/memories/docs' && (!init.method || init.method === 'GET')) {
        return Response.json({ docs: [{ project_key: 'acme', source_url: 'https://x.test/g', title: 'Guide', chunks: 4 }] });
      }
      if (path === '/api/memories/docs' && init.method === 'DELETE') {
        return Response.json({ deleted: 'https://x.test/g', chunks: 4 });
      }
      throw new Error(`Unexpected request: ${path} ${init.method}`);
    });
    expect(await main(['memory', 'ingest', 'https://x.test/g', '--project', 'acme'])).toBe(0);
    expect(output).toContain('ingested 4 chunks from https://x.test/g (Guide)');
    output = '';
    expect(await main(['memory', 'docs', '--project', 'acme'])).toBe(0);
    expect(output).toContain('acme\t4 chunks\tGuide\thttps://x.test/g');
    output = '';
    expect(await main(['memory', 'undoc', 'https://x.test/g', '--project', 'acme'])).toBe(0);
    expect(output).toContain('deleted https://x.test/g (4 chunks)');
  });

  it('rejects bad invocations without a request', async () => {
    const fetchSpy = vi.fn(async () => Response.json({}));
    vi.stubGlobal('fetch', fetchSpy);
    await expect(main(['memory', 'add', '--key', 'k'])).rejects.toThrow('--value');
    await expect(main(['memory', 'delete'])).rejects.toThrow('positive memory id');
    await expect(main(['memory', 'list', '--scope', 'bogus'])).rejects.toThrow('--scope must be');
    await expect(main(['memory', 'ingest', 'https://x.test/g'])).rejects.toThrow('--project KEY');
    await expect(main(['memory', 'undoc'])).rejects.toThrow('needs a URL');
    await expect(main(['memory', 'frobnicate'])).rejects.toThrow('memory list, add, delete, ingest, docs, or undoc');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('automate', () => {
  const AUTO = {
    id: 1, name: 'brief', goal: 'Brief me', schedule: '0 9 * * *', model: 'auto',
    enabled: 1, reviewed: 1, last_run_id: 7, last_status: 'done', last_run_at: null, next_run_at: null,
  };

  it('lists, adds, runs, toggles, and removes automations', async () => {
    stubFetch((path, init) => {
      if (path === '/api/automations' && (!init.method || init.method === 'GET')) return Response.json({ automations: [AUTO] });
      if (path === '/api/automations' && init.method === 'POST') {
        return Response.json({ automation: { ...AUTO, id: 2, name: 'digest' } }, { status: 201 });
      }
      if (path === '/api/automations/1/run') return Response.json({ run_id: 9 });
      if (path === '/api/automations/1' && init.method === 'PATCH') {
        return Response.json({ automation: { ...AUTO, enabled: 0 } });
      }
      if (path === '/api/automations/1' && init.method === 'DELETE') return Response.json({ deleted: 1 });
      throw new Error(`Unexpected request: ${path} ${init.method}`);
    });
    expect(await main(['automate', 'list'])).toBe(0);
    expect(output).toContain('brief\tenabled\treviewed');
    output = '';
    expect(await main(['automate', 'add', '--name', 'digest', '--goal', 'Digest', '--schedule', '0 8 * * *'])).toBe(0);
    expect(output).toContain('added digest (id 2)');
    output = '';
    expect(await main(['automate', 'run', 'brief'])).toBe(0);
    expect(output).toContain('brief: run 9 started');
    output = '';
    expect(await main(['automate', 'disable', 'brief'])).toBe(0);
    expect(output).toContain('brief: disabled');
    output = '';
    expect(await main(['automate', 'remove', 'brief'])).toBe(0);
    expect(output).toContain('deleted brief');
    output = '';
    await expect(main(['automate', 'run', 'ghost'])).rejects.toThrow('Unknown automation: ghost');
  });

  it('rejects bad invocations without a request', async () => {
    const fetchSpy = vi.fn(async () => Response.json({}));
    vi.stubGlobal('fetch', fetchSpy);
    await expect(main(['automate', 'add', '--name', 'x'])).rejects.toThrow('--goal');
    await expect(main(['automate', 'run'])).rejects.toThrow('automation name');
    await expect(main(['automate', 'frobnicate'])).rejects.toThrow('automate list, add, run, enable, disable, or remove');
    await expect(main(['automate', 'list', '--tools', 'x'])).rejects.toThrow('--tools is not supported by automate');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
