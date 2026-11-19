// Dashboard-authenticated control of the outbound MCP registry: register
// servers, test connections, and call tools directly. Like the other
// dashboard commands, these need OMNIPIX_DASHBOARD_TOKEN / --token.

export interface McpCommandOptions {
  url: string;
  args: string[];
  token?: string;
  asName?: string;
  name?: string;
  transport?: string;
  command?: string;
  cmdArgs?: string;
  serverUrl?: string;
  env?: string;
  headers?: string;
  tool?: string;
  toolArgs?: string;
  timeoutMs?: number;
  dryRun: boolean;
}

export function mcpHelp(): string {
  return [
    'Outbound MCP servers (dashboard authentication):',
    '  omnipix mcp list',
    '  omnipix mcp add --name N --transport stdio|http [--command C] [--cmd-args a,b] [--server-url U] [--env K=V,...] [--headers H:V,...]',
    '  omnipix mcp install <registry-name> [--as LOCAL] [--env K=V,...]',
    '  omnipix mcp remove <name>',
    '  omnipix mcp enable <name>',
    '  omnipix mcp disable <name>',
    '  omnipix mcp test <name>',
    '  omnipix mcp tools',
    '  omnipix mcp call --tool mcp:<server>:<tool> [--tool-args JSON]',
    '',
    'Options: --url URL, --token TOKEN, --timeout MS (default 30000)',
    'Secrets (--env, --headers) are encrypted at rest and never printed back.',
  ].join('\n');
}

interface McpServer {
  id: number;
  name: string;
  transport: string;
  command: string;
  args: string[];
  url: string;
  enabled: number;
  tool_count: number | null;
  last_error: string | null;
}

interface McpTool {
  qualifiedName: string;
  serverName: string;
  name: string;
  description?: string;
}

function gatewayRoot(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('--url must be an HTTP(S) gateway URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('--url must be an HTTP(S) URL without credentials, a query, or a fragment');
  }
  return url.href.replace(/\/+$/, '').replace(/\/v1$/i, '');
}

function setup(options: McpCommandOptions): { request: <T>(path: string, method?: string, body?: unknown) => Promise<T> } {
  const token = options.token?.trim();
  if (!token) throw new Error('Set OMNIPIX_DASHBOARD_TOKEN or pass --token with a dashboard session token');
  const root = gatewayRoot(options.url);
  const timeout = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 2_147_483_647) {
    throw new Error('--timeout must be a positive integer of at most 2147483647 milliseconds');
  }

  async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${root}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
        redirect: 'error',
        cache: 'no-store',
      });
    } catch {
      throw new Error('Could not complete the dashboard request. Check --url, connectivity, and --timeout.');
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error('Dashboard authentication failed. Supply a current dashboard session token with --token or OMNIPIX_DASHBOARD_TOKEN.');
    }
    if (!response.ok) {
      const message = await response.json().then(
        (data: unknown) => (data as { error?: { message?: string } })?.error?.message,
        () => undefined,
      ).catch(() => undefined);
      throw new Error(message ? `Dashboard request failed: ${message}` : `Dashboard request failed (HTTP ${response.status})`);
    }
    return response.json() as Promise<T>;
  }

  return { request };
}

function csv(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value.split(',').map(part => part.trim()).filter(Boolean);
}

function pairs(value: string | undefined, sep: '=' | ':'): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of csv(value)) {
    const idx = part.indexOf(sep);
    if (idx <= 0) throw new Error(`Invalid pair '${part}': expected KEY${sep}value`);
    out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

export async function runMcp(
  options: McpCommandOptions,
  write: (line: string) => void = line => process.stdout.write(`${line}\n`),
): Promise<number> {
  const [action, nameArg, ...extra] = options.args;
  if (!action || !['list', 'add', 'install', 'remove', 'enable', 'disable', 'test', 'tools', 'call'].includes(action)) {
    throw new Error(`Expected mcp list, add, install, remove, enable, disable, test, tools, or call.\n\n${mcpHelp()}`);
  }
  if (options.dryRun) throw new Error('--dry-run is not supported by mcp; no request was made');
  const { request } = setup(options);

  if (action === 'list') {
    if (nameArg !== undefined || extra.length) throw new Error(`Invalid arguments for mcp list.\n\n${mcpHelp()}`);
    const { servers } = await request<{ servers: McpServer[] }>('/api/mcp/servers');
    for (const server of servers) {
      const where = server.transport === 'stdio'
        ? `${server.command} ${server.args.join(' ')}`.trim()
        : server.url;
      write(`${server.name}\t${server.transport}\t${server.enabled ? 'enabled' : 'disabled'}\t${server.tool_count ?? '-'} tools\t${where}${server.last_error ? `\tERROR: ${server.last_error}` : ''}`);
    }
    return 0;
  }

  if (action === 'add') {
    if (nameArg !== undefined || extra.length) throw new Error(`Invalid arguments for mcp add.\n\n${mcpHelp()}`);
    const name = options.name?.trim();
    const transport = options.transport?.trim();
    if (!name) throw new Error('mcp add needs --name N');
    if (transport !== 'stdio' && transport !== 'http') throw new Error('mcp add needs --transport stdio|http');
    const { server } = await request<{ server: McpServer }>('/api/mcp/servers', 'POST', {
      name,
      transport,
      command: options.command,
      args: csv(options.cmdArgs),
      url: options.serverUrl,
      env: pairs(options.env, '='),
      headers: pairs(options.headers, ':'),
    });
    write(`added ${server.name} (id ${server.id})`);
    return 0;
  }

  if (action === 'install') {
    if (nameArg === undefined || extra.length) throw new Error(`Invalid arguments for mcp install.\n\n${mcpHelp()}`);
    const { server } = await request<{ server: McpServer }>('/api/mcp/install', 'POST', {
      name: nameArg,
      as: options.asName,
      env: pairs(options.env, '='),
    });
    write(`installed ${server.name} (id ${server.id})`);
    return 0;
  }

  if (action === 'tools') {
    if (nameArg !== undefined || extra.length) throw new Error(`Invalid arguments for mcp tools.\n\n${mcpHelp()}`);
    const { tools } = await request<{ tools: McpTool[] }>('/api/mcp/tools');
    for (const tool of tools) {
      write(`${tool.qualifiedName}\t${tool.description ?? ''}`);
    }
    return 0;
  }

  if (action === 'call') {
    if (nameArg !== undefined || extra.length) throw new Error(`Invalid arguments for mcp call.\n\n${mcpHelp()}`);
    if (!options.tool?.trim()) throw new Error('mcp call needs --tool mcp:<server>:<tool>');
    let toolArgs: Record<string, unknown> = {};
    if (options.toolArgs !== undefined) {
      try {
        const parsed: unknown = JSON.parse(options.toolArgs);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
        toolArgs = parsed as Record<string, unknown>;
      } catch {
        throw new Error('--tool-args must be a JSON object');
      }
    }
    const { output } = await request<{ output: string }>('/api/mcp/call', 'POST', { tool: options.tool.trim(), args: toolArgs });
    write(output);
    return 0;
  }

  // remove / enable / disable / test address servers by name; resolve to id.
  if (!nameArg || extra.length) throw new Error(`mcp ${action} needs a server name.\n\n${mcpHelp()}`);
  const { servers } = await request<{ servers: McpServer[] }>('/api/mcp/servers');
  const server = servers.find(s => s.name === nameArg);
  if (!server) throw new Error(`Unknown MCP server: ${nameArg}`);
  if (action === 'remove') {
    await request(`/api/mcp/servers/${server.id}`, 'DELETE');
    write(`deleted ${nameArg}`);
    return 0;
  }
  if (action === 'enable' || action === 'disable') {
    const updated = await request<{ server: McpServer }>(
      `/api/mcp/servers/${server.id}`, 'PATCH', { enabled: action === 'enable' },
    );
    write(`${nameArg}: ${updated.server.enabled ? 'enabled' : 'disabled'}`);
    return 0;
  }
  const tested = await request<{ tools: Array<{ name: string }> }>(`/api/mcp/servers/${server.id}/test`, 'POST');
  write(`${nameArg}: connected (${tested.tools.map(t => t.name).join(', ') || 'no tools'})`);
  return 0;
}
