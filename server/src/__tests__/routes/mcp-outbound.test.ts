import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb } from '../../db/index.js';
import { mintDashboardToken, isGatedApiPath } from '../helpers/auth.js';
import { __dropAllConnections } from '../../services/mcp-servers.js';
import { MCP_PROTOCOL_LATEST } from '../../lib/mcp-client.js';

let app: Express;
let dashToken: string;
const nativeFetch = globalThis.fetch.bind(globalThis);

async function call(method: string, path: string, body?: unknown, authed = true) {
  const server = app.listen(0, '127.0.0.1');
  if (!server.listening) await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const addr = server.address() as { port: number };
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authed && isGatedApiPath(path)) headers['Authorization'] = `Bearer ${dashToken}`;
  const res = await nativeFetch(`http://127.0.0.1:${addr.port}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  server.close();
  return { status: res.status, body: data as any };
}

const FAKE_SERVER = `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.id === undefined) return;
  const reply = (result, error) => console.log(JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...(error ? { error } : { result }) }));
  if (msg.method === 'initialize') {
    reply({ protocolVersion: '${MCP_PROTOCOL_LATEST}', capabilities: {}, serverInfo: { name: 'fake', version: '0' } });
    return;
  }
  if (msg.method === 'tools/list') {
    reply({ tools: [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object' } }] });
    return;
  }
  if (msg.method === 'tools/call') {
    reply({ content: [{ type: 'text', text: 'echo:' + (msg.params.arguments?.text ?? '') }] });
    return;
  }
  reply(null, { code: -32601, message: 'unknown method' });
});
`;

describe('outbound MCP registry', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    app = createApp();
    dashToken = mintDashboardToken();
  });

  afterEach(async () => {
    await __dropAllConnections();
    globalThis.fetch = nativeFetch;
    vi.unstubAllGlobals();
  });

  it('requires dashboard auth', async () => {
    expect((await call('GET', '/api/mcp/servers', undefined, false)).status).toBe(401);
  });

  it('creates, reads, updates, and deletes servers without leaking secrets', async () => {
    const created = await call('POST', '/api/mcp/servers', {
      name: 'fs', transport: 'stdio', command: 'npx', args: ['-y', 'x'], env: { TOKEN: 's3cret' },
    });
    expect(created.status).toBe(201);
    expect(created.body.server).toMatchObject({ name: 'fs', transport: 'stdio', enabled: 1 });
    expect(JSON.stringify(created.body)).not.toContain('s3cret');

    expect((await call('POST', '/api/mcp/servers', {
      name: 'fs', transport: 'stdio', command: 'npx',
    })).status).toBe(409);
    expect((await call('POST', '/api/mcp/servers', {
      name: 'Bad Name!', transport: 'stdio', command: 'y',
    })).status).toBe(400);
    expect((await call('POST', '/api/mcp/servers', { name: 'x', transport: 'http' })).status).toBe(400);

    const id = created.body.server.id;
    expect((await call('GET', `/api/mcp/servers/${id}`)).status).toBe(200);
    expect((await call('GET', '/api/mcp/servers/99999')).status).toBe(404);
    const updated = await call('PATCH', `/api/mcp/servers/${id}`, { enabled: false });
    expect(updated.status).toBe(200);
    expect(updated.body.server.enabled).toBe(0);
    expect((await call('PATCH', '/api/mcp/servers/99999', { enabled: true })).status).toBe(404);

    const listed = await call('GET', '/api/mcp/servers');
    expect(listed.body.servers.map((s: any) => s.name)).toEqual(['fs']);

    expect((await call('DELETE', `/api/mcp/servers/${id}`)).status).toBe(200);
    expect((await call('DELETE', `/api/mcp/servers/${id}`)).status).toBe(404);
  });

  it('tests a live server, aggregates tools, and calls one directly', async () => {
    const script = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'omnipix-mcp-')), 'fake-server.cjs');
    fs.writeFileSync(script, FAKE_SERVER);
    const created = await call('POST', '/api/mcp/servers', {
      name: 'fake', transport: 'stdio', command: process.execPath, args: [script],
    });
    expect(created.status).toBe(201);
    const id = created.body.server.id;
    const tested = await call('POST', `/api/mcp/servers/${id}/test`);
    expect(tested.status).toBe(200);
    expect(tested.body.tools.map((t: any) => t.name)).toEqual(['echo']);

    const tools = await call('GET', '/api/mcp/tools');
    expect(tools.body.tools.map((t: any) => t.qualifiedName)).toEqual(['mcp:fake:echo']);

    const called = await call('POST', '/api/mcp/call', { tool: 'mcp:fake:echo', args: { text: 'yo' } });
    expect(called.status).toBe(200);
    expect(called.body.output).toBe('echo:yo');
    expect((await call('POST', '/api/mcp/call', { tool: 'mcp:ghost:echo' })).status).toBe(502);
    expect((await call('POST', '/api/mcp/call', {})).status).toBe(400);
  });

  it('reports dead servers as 502 and keeps them listed', async () => {
    await call('PUT', '/api/settings/mcp-allowed-commands', { commands: ['mcp-xyz'] });
    const created = await call('POST', '/api/mcp/servers', {
      name: 'dead', transport: 'stdio', command: '/nonexistent/mcp-xyz',
    });
    const id = created.body.server.id;
    const tested = await call('POST', `/api/mcp/servers/${id}/test`);
    expect(tested.status).toBe(502);
    const listed = await call('GET', '/api/mcp/servers');
    expect(listed.body.servers[0].last_error).toBeTruthy();
    expect((await call('GET', '/api/mcp/tools')).body.tools).toEqual([]);
    expect((await call('POST', `/api/mcp/servers/99999/test`)).status).toBe(404);
  });

  it('installs an npm server from the registry with one call', async () => {
    globalThis.fetch = (async () => Response.json({
      name: 'io.github.acme/notes',
      description: 'Notes server.',
      version: '1.2.0',
      packages: [{
        registryType: 'npm',
        identifier: '@acme/mcp-notes',
        version: '1.2.0',
        transport: 'stdio',
        environmentVariables: [{ name: 'NOTES_TOKEN', required: true }],
      }],
    })) as unknown as typeof fetch;
    // Required env missing: loud 400, no row.
    const missing = await call('POST', '/api/mcp/install', { name: 'io.github.acme/notes' });
    expect(missing.status).toBe(400);
    expect(missing.body.error.message).toContain('NOTES_TOKEN');
    const installed = await call('POST', '/api/mcp/install', {
      name: 'io.github.acme/notes', env: { NOTES_TOKEN: 's3cret' },
    });
    expect(installed.status).toBe(201);
    expect(installed.body.server).toMatchObject({
      name: 'notes', transport: 'stdio', command: 'npx',
    });
    expect(installed.body.registryVersion).toBe('1.2.0');
    expect(JSON.stringify(installed.body)).not.toContain('s3cret');
  });

  it('prefers a hosted streamable-http endpoint when offered', async () => {
    globalThis.fetch = (async () => Response.json({
      name: 'com.acme/hosted',
      version: '2.0.0',
      remotes: [{ type: 'streamable-http', url: 'https://mcp.acme.test/mcp' }],
      packages: [{ registryType: 'npm', identifier: '@acme/x', transport: 'stdio' }],
    })) as unknown as typeof fetch;
    const installed = await call('POST', '/api/mcp/install', { name: 'com.acme/hosted', as: 'acme' });
    expect(installed.status).toBe(201);
    expect(installed.body.server).toMatchObject({ name: 'acme', transport: 'http', url: 'https://mcp.acme.test/mcp' });
  });

  it('maps pypi and docker packages, and 404s unknown names', async () => {
    globalThis.fetch = (async (url: string) => {
      if (String(url).includes('missing')) return new Response('nope', { status: 404 });
      return Response.json({
        name: 'io.github.acme/py', version: '1.0.0',
        packages: [{ registryType: 'pypi', identifier: 'acme-mcp', transport: 'stdio' }],
      });
    }) as unknown as typeof fetch;
    const py = await call('POST', '/api/mcp/install', { name: 'io.github.acme/py' });
    expect(py.status).toBe(201);
    expect(py.body.server).toMatchObject({ name: 'py', transport: 'stdio', command: 'uvx' });
    expect((await call('POST', '/api/mcp/install', { name: 'io.missing/srv' })).status).toBe(404);
  });

  it('browses the registry catalog with search and cursors', async () => {
    const seen: string[] = [];
    globalThis.fetch = (async (url: string) => {
      seen.push(String(url));
      return Response.json({
        servers: [
          {
            server: {
              name: 'io.github.acme/notes', title: 'Notes', description: 'Notes server.', version: '1.2.0',
              packages: [{ registryType: 'npm', identifier: '@acme/mcp-notes', transport: 'stdio' }],
            },
            _meta: { 'io.modelcontextprotocol.registry/official': { isLatest: true } },
          },
          { server: { description: 'Nameless entry is skipped.' } },
        ],
        metadata: { nextCursor: 'cursor-1', count: 2 },
      });
    }) as unknown as typeof fetch;
    const page = await call('GET', '/api/mcp/registry?q=notes&limit=10');
    expect(page.status).toBe(200);
    expect(page.body.nextCursor).toBe('cursor-1');
    expect(page.body.servers).toEqual([{
      name: 'io.github.acme/notes', title: 'Notes', description: 'Notes server.', version: '1.2.0',
      isLatest: true, transports: ['stdio'],
    }]);
    expect(seen[0]).toContain('search=notes');
    expect(seen[0]).toContain('limit=10');
    expect((await call('GET', '/api/mcp/registry?limit=0')).status).toBe(400);
    expect((await call('GET', '/api/mcp/registry?limit=51')).status).toBe(400);

    globalThis.fetch = (async () => new Response('down', { status: 500 })) as unknown as typeof fetch;
    expect((await call('GET', '/api/mcp/registry')).status).toBe(502);
  });
});
