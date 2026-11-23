import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { McpClient, McpError, MCP_PROTOCOL_FALLBACK, MCP_PROTOCOL_LATEST } from '../../lib/mcp-client.js';

// Minimal in-test MCP server over stdio: initialize (rejects unknown
// versions), tools/list, tools/call. Runs the tests with zero network.
const FAKE_SERVER = `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, terminal: false });
console.error('fake server booted');
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
    reply({ tools: [
      { name: 'echo', description: 'Echo text', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
      { name: 'boom', description: 'Always errors', inputSchema: { type: 'object' } },
    ] });
    return;
  }
  if (msg.method === 'tools/call') {
    if (msg.params?.name === 'echo') {
      reply({ content: [{ type: 'text', text: 'echo:' + (msg.params.arguments?.text ?? '') }] });
      return;
    }
    reply({ content: [{ type: 'text', text: 'kaboom' }], isError: true });
    return;
  }
  reply(null, { code: -32601, message: 'unknown method' });
});
`;

describe('MCP client', () => {
  const clients: McpClient[] = [];
  let httpServer: http.Server | null = null;

  afterEach(async () => {
    for (const client of clients.splice(0)) {
      await client.close().catch(() => undefined);
    }
    if (httpServer) {
      await new Promise<void>(resolve => httpServer!.close(() => resolve()));
      httpServer = null;
    }
  });

  function startHttpServer(handler: (msg: any) => any, sse: boolean): Promise<string> {
    return new Promise<string>(resolve => {
      httpServer = http.createServer((req, res) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          const msg = JSON.parse(body);
          if (msg.id === undefined) {
            res.writeHead(202).end();
            return;
          }
          let result: unknown;
          try {
            result = handler(msg);
          } catch {
            // A crashing upstream kills the socket mid-request; the client
            // must surface that as an error, not hang. destroy() reproduces
            // the exact wire behavior (RST, no response bytes) without
            // throwing uncaught out of the request handler, which Vitest
            // reports as an unhandled error on every full run.
            res.destroy();
            return;
          }
          const payload = JSON.stringify({ jsonrpc: '2.0', id: msg.id, result });
          if (sse) {
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            res.end(`data: ${payload}\n\n`);
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(payload);
          }
        });
      });
      httpServer.listen(0, '127.0.0.1', () => {
        resolve(`http://127.0.0.1:${(httpServer!.address() as AddressInfo).port}/mcp`);
      });
    });
  }

  const fakeHandler = (msg: any) => {
    if (msg.method === 'initialize') {
      return { protocolVersion: msg.params.protocolVersion, capabilities: {}, serverInfo: { name: 'fake-http', version: '0' } };
    }
    if (msg.method === 'tools/list') {
      return { tools: [{ name: 'add', description: 'Add', inputSchema: { type: 'object' } }] };
    }
    if (msg.method === 'tools/call') {
      return { content: [{ type: 'text', text: 'sum:7' }] };
    }
    throw new Error('unexpected');
  };

  it('connects over stdio, lists tools, and calls one', async () => {
    const client = await McpClient.stdio(process.execPath, ['-e', FAKE_SERVER], {}, { timeoutMs: 5000 });
    clients.push(client);
    expect(client.protocolVersion).toBe(MCP_PROTOCOL_LATEST);
    expect(client.serverInfo).toMatchObject({ name: 'fake' });
    const tools = await client.listTools();
    expect(tools.map(t => t.name)).toEqual(['echo', 'boom']);
    expect(tools[0].inputSchema).toMatchObject({ type: 'object' });
    const ok = await client.callTool('echo', { text: 'hi' });
    expect(ok.isError).not.toBe(true);
    expect(ok.content).toEqual([{ type: 'text', text: 'echo:hi' }]);
    const failed = await client.callTool('boom', {});
    expect(failed.isError).toBe(true);
  });

  it('fails fast when the stdio command cannot spawn', async () => {
    await expect(McpClient.stdio('/nonexistent/mcp-server-xyz', [], {}, { timeoutMs: 2000 }))
      .rejects.toThrow(McpError);
  });

  it('connects over Streamable HTTP as JSON and as SSE', async () => {
    for (const sse of [false, true]) {
      const url = await startHttpServer(fakeHandler, sse);
      const client = await McpClient.http(url, { timeoutMs: 5000 });
      clients.push(client);
      expect(client.serverInfo).toMatchObject({ name: 'fake-http' });
      expect((await client.listTools()).map(t => t.name)).toEqual(['add']);
      expect((await client.callTool('add', {})).content).toEqual([{ type: 'text', text: 'sum:7' }]);
      await new Promise<void>(resolve => httpServer!.close(() => resolve()));
      httpServer = null;
    }
  });

  it('rejects bad HTTP urls and surfaces HTTP errors', async () => {
    await expect(McpClient.http('not a url')).rejects.toThrow('invalid MCP server URL');
    await expect(McpClient.http('ftp://x.test/mcp')).rejects.toThrow('http(s)');
    const url = await startHttpServer(() => { throw new Error('x'); }, false);
    // Handler throws → our test server crashes the socket; client must error, not hang.
    await expect(McpClient.http(url, { timeoutMs: 2000 })).rejects.toThrow(McpError);
  });
});
