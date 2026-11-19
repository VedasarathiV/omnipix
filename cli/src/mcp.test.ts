import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from './index.js';

const token = 'dashboard-session==';
let output: string;

const SERVERS = [
  { id: 1, name: 'fs', transport: 'stdio', command: 'npx', args: ['-y', 'x'], url: '', enabled: 1, tool_count: 2, last_error: null },
];

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

describe('mcp', () => {
  it('lists servers and tools', async () => {
    stubFetch(path => {
      if (path === '/api/mcp/servers') return Response.json({ servers: SERVERS });
      if (path === '/api/mcp/tools') {
        return Response.json({ tools: [{ qualifiedName: 'mcp:fs:read', serverName: 'fs', name: 'read', description: 'Read' }] });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    expect(await main(['mcp', 'list'])).toBe(0);
    expect(output).toContain('fs\tstdio\tenabled\t2 tools');
    output = '';
    expect(await main(['mcp', 'tools'])).toBe(0);
    expect(output).toContain('mcp:fs:read');
  });

  it('adds a server with parsed flags', async () => {
    let seenBody = '';
    stubFetch((path, init) => {
      if (path === '/api/mcp/servers' && init.method === 'POST') {
        seenBody = String(init.body);
        return Response.json({ server: { id: 2, name: 'git' } }, { status: 201 });
      }
      throw new Error(`Unexpected request: ${path} ${init.method}`);
    });
    expect(await main(['mcp', 'add', '--name', 'git', '--transport', 'stdio', '--command', 'mcp-git', '--env', 'A=1,B=2'])).toBe(0);
    expect(output).toContain('added git (id 2)');
    expect(JSON.parse(seenBody)).toMatchObject({
      name: 'git', transport: 'stdio', command: 'mcp-git', env: { A: '1', B: '2' },
    });
  });

  it('installs from the registry with a local name and env', async () => {
    let seenBody = '';
    stubFetch((path, init) => {
      if (path === '/api/mcp/install' && init.method === 'POST') {
        seenBody = String(init.body);
        return Response.json({ server: { id: 3, name: 'notes' } }, { status: 201 });
      }
      throw new Error(`Unexpected request: ${path} ${init.method}`);
    });
    expect(await main(['mcp', 'install', 'io.github.acme/notes', '--as', 'notes', '--env', 'NOTES_TOKEN=s3cret'])).toBe(0);
    expect(output).toContain('installed notes (id 3)');
    expect(JSON.parse(seenBody)).toEqual({
      name: 'io.github.acme/notes',
      as: 'notes',
      env: { NOTES_TOKEN: 's3cret' },
    });
  });

  it('removes, toggles, and tests servers by name', async () => {
    stubFetch((path, init) => {
      if (path === '/api/mcp/servers') return Response.json({ servers: SERVERS });
      if (path === '/api/mcp/servers/1' && init.method === 'DELETE') return Response.json({ deleted: 1 });
      if (path === '/api/mcp/servers/1' && init.method === 'PATCH') {
        return Response.json({ server: { ...SERVERS[0], enabled: 0 } });
      }
      if (path === '/api/mcp/servers/1/test') return Response.json({ tools: [{ name: 'a' }, { name: 'b' }] });
      throw new Error(`Unexpected request: ${path} ${init.method}`);
    });
    expect(await main(['mcp', 'disable', 'fs'])).toBe(0);
    expect(output).toContain('fs: disabled');
    output = '';
    expect(await main(['mcp', 'test', 'fs'])).toBe(0);
    expect(output).toContain('fs: connected (a, b)');
    output = '';
    expect(await main(['mcp', 'remove', 'fs'])).toBe(0);
    expect(output).toContain('deleted fs');
    output = '';
    await expect(main(['mcp', 'test', 'ghost'])).rejects.toThrow('Unknown MCP server: ghost');
  });

  it('calls a tool with parsed JSON args', async () => {
    stubFetch(path => {
      if (path === '/api/mcp/call') return Response.json({ output: 'echo:yo' });
      throw new Error(`Unexpected request: ${path}`);
    });
    expect(await main(['mcp', 'call', '--tool', 'mcp:fs:echo', '--tool-args', '{"text":"yo"}'])).toBe(0);
    expect(output).toContain('echo:yo');
  });

  it('rejects bad invocations without a request', async () => {
    const fetchSpy = vi.fn(async () => Response.json({}));
    vi.stubGlobal('fetch', fetchSpy);
    await expect(main(['mcp', 'add', '--name', 'x'])).rejects.toThrow('--transport');
    await expect(main(['mcp', 'call'])).rejects.toThrow('--tool');
    await expect(main(['mcp', 'call', '--tool', 'mcp:a:b', '--tool-args', 'nope'])).rejects.toThrow('JSON object');
    await expect(main(['mcp', 'remove'])).rejects.toThrow('server name');
    await expect(main(['mcp', 'frobnicate'])).rejects.toThrow('mcp list, add, install, remove, enable, disable, test, tools, or call');
    await expect(main(['mcp', 'install'])).rejects.toThrow('Invalid arguments for mcp install');
    await expect(main(['mcp', 'list', '--goal', 'x'])).rejects.toThrow('--goal is not supported by mcp');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
