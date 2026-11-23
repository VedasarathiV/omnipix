import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initDb, getDb, setSetting } from '../../db/index.js';
import { MCP_ALLOWED_COMMANDS_SETTING } from '../../lib/mcp-allowlist.js';
import {
  __dropAllConnections,
  callMcpTool,
  createMcpServer,
  deleteMcpServer,
  getMcpServer,
  listMcpServers,
  listMcpTools,
  parseQualifiedName,
  testMcpServer,
  updateMcpServer,
} from '../../services/mcp-servers.js';
import { MCP_PROTOCOL_FALLBACK, MCP_PROTOCOL_LATEST } from '../../lib/mcp-client.js';

const FAKE_SERVER = `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.id === undefined) return;
  const reply = (result, error) => console.log(JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...(error ? { error } : { result }) }));
  if (msg.method === 'initialize') {
    const v = msg.params?.protocolVersion;
    if (v !== '${MCP_PROTOCOL_LATEST}' && v !== '${MCP_PROTOCOL_FALLBACK}') {
      reply(null, { code: -32602, message: 'unsupported version' });
      return;
    }
    reply({ protocolVersion: v, capabilities: {}, serverInfo: { name: 'fake', version: '0' } });
    return;
  }
  if (msg.method === 'tools/list') {
    reply({ tools: [{ name: 'echo', description: 'Echo text', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] });
    return;
  }
  if (msg.method === 'tools/call') {
    if (msg.params?.name !== 'echo') {
      reply(null, { code: -32602, message: 'unknown tool' });
      return;
    }
    reply({ content: [{ type: 'text', text: 'echo:' + (msg.params.arguments?.text ?? '') }] });
    return;
  }
  reply(null, { code: -32601, message: 'unknown method' });
});
`;

describe('MCP servers', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
  });

  afterEach(async () => {
    await __dropAllConnections();
  });

  it('creates, lists, updates, and deletes servers', () => {
    const id = createMcpServer({
      name: 'fs', transport: 'stdio', command: 'npx', args: ['-y', 'x'],
      env: { TOKEN: 's3cret' },
    });
    const server = getMcpServer(id)!;
    expect(server).toMatchObject({ name: 'fs', transport: 'stdio', command: 'npx', enabled: 1 });
    expect(server.args).toEqual(['-y', 'x']);
    // Secrets are encrypted at rest, never returned.
    expect(JSON.stringify(server)).not.toContain('s3cret');
    const row = getDb().prepare('SELECT env_encrypted FROM mcp_servers WHERE id = ?').get(id) as { env_encrypted: string };
    expect(row.env_encrypted).not.toContain('s3cret');

    expect(() => createMcpServer({ name: 'fs', transport: 'stdio', command: 'npx' })).toThrow('already exists');
    expect(() => createMcpServer({ name: 'Bad Name', transport: 'stdio', command: 'y' })).toThrow('Invalid server name');
    expect(() => createMcpServer({ name: 'x', transport: 'stdio' })).toThrow('need a command');
    expect(() => createMcpServer({ name: 'x', transport: 'http' })).toThrow('need a url');

    updateMcpServer(id, { enabled: false });
    expect(getMcpServer(id)!.enabled).toBe(0);
    expect(() => updateMcpServer(99999, { enabled: true })).toThrow('not found');

    expect(listMcpServers().map(s => s.name)).toEqual(['fs']);
    expect(deleteMcpServer(id)).toBe(true);
    expect(deleteMcpServer(id)).toBe(false);
    expect(getMcpServer(id)).toBeNull();
  });

  it('parses qualified tool names', () => {
    expect(parseQualifiedName('mcp:fs:read')).toEqual({ server: 'fs', tool: 'read' });
    expect(parseQualifiedName('calculator')).toBeNull();
    expect(parseQualifiedName('mcp:nope')).toBeNull();
    expect(parseQualifiedName('mcp::x')).toBeNull();
  });

  it('tests a live stdio server and records its tools', async () => {
    const id = createMcpServer({ name: 'fake', transport: 'stdio', command: process.execPath, args: ['-e', FAKE_SERVER] });
    const result = await testMcpServer(id);
    expect(result.tools.map(t => t.name)).toEqual(['echo']);
    expect(result.serverInfo).toMatchObject({ name: 'fake' });
    expect(getMcpServer(id)).toMatchObject({ last_error: null, tool_count: 1 });
  });

  it('audit-logs stdio spawns without args or env secrets', async () => {
    const seen: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => { seen.push(args.map(String).join(' ')); };
    try {
      const id = createMcpServer({
        name: 'audited', transport: 'stdio', command: process.execPath,
        args: ['-e', FAKE_SERVER], env: { MCP_TOKEN: 'supersecret-token-value' },
      });
      await testMcpServer(id);
    } finally {
      console.warn = origWarn;
    }
    const line = seen.find(s => s.includes("[mcp] spawning stdio server 'audited'"));
    expect(line).toBeTruthy();
    expect(line!).toContain(process.execPath);
    expect(line!).toContain('(2 args)');
    expect(seen.join('\n')).not.toContain('supersecret-token-value');
    expect(seen.join('\n')).not.toContain(FAKE_SERVER);
  });

  it('rejects non-allowlisted commands at registration', () => {
    expect(() => createMcpServer({ name: 'evil', transport: 'stdio', command: '/bin/sh' }))
      .toThrow('not allowlisted');
    expect(() => createMcpServer({ name: 'ok', transport: 'stdio', command: 'npx', args: ['-y', 'x'] }))
      .not.toThrow();
  });

  it('spawn re-check disarms rows after the list narrows', async () => {
    const id = createMcpServer({
      name: 'narrowed', transport: 'stdio', command: process.execPath, args: ['-e', FAKE_SERVER],
    });
    await expect(testMcpServer(id)).resolves.toBeTruthy();
    setSetting(MCP_ALLOWED_COMMANDS_SETTING, JSON.stringify([]));
    await expect(testMcpServer(id)).rejects.toThrow('not allowlisted');
  });

  it('records failures on dead servers without throwing the list', async () => {
    setSetting(MCP_ALLOWED_COMMANDS_SETTING, JSON.stringify(['mcp-xyz']));
    const id = createMcpServer({ name: 'dead', transport: 'stdio', command: '/nonexistent/mcp-xyz' });
    await expect(testMcpServer(id)).rejects.toThrow();
    expect(getMcpServer(id)!.last_error).toBeTruthy();
    // listMcpTools skips the dead server instead of failing.
    expect(await listMcpTools()).toEqual([]);
  });

  it('aggregates namespaced tools and calls through the pool', async () => {
    const id = createMcpServer({ name: 'fake', transport: 'stdio', command: process.execPath, args: ['-e', FAKE_SERVER] });
    const tools = await listMcpTools();
    expect(tools.map(t => t.qualifiedName)).toEqual(['mcp:fake:echo']);
    expect(tools[0].inputSchema).toMatchObject({ type: 'object' });
    expect(await callMcpTool('mcp:fake:echo', { text: 'hi' })).toBe('echo:hi');
    // Second call reuses the pooled connection.
    expect(await callMcpTool('mcp:fake:echo', { text: 'again' })).toBe('echo:again');
    await expect(callMcpTool('mcp:fake:missing', {})).rejects.toThrow();
    await expect(callMcpTool('mcp:ghost:echo', {})).rejects.toThrow('unknown MCP server');
    await expect(callMcpTool('calculator', {})).rejects.toThrow('not an MCP tool');
    // Disabling cuts the pool: calls fail closed.
    updateMcpServer(id, { enabled: false });
    await expect(callMcpTool('mcp:fake:echo', {})).rejects.toThrow('disabled');
  });
});
