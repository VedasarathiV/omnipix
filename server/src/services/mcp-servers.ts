import { getDb } from '../db/index.js';
import { decrypt, encrypt } from '../lib/crypto.js';
import { McpClient, type McpToolDef } from '../lib/mcp-client.js';

// MCP server registry + connection pool (Phase 2).
//
// Operators register outbound MCP servers (local stdio commands or remote
// Streamable HTTP endpoints); the agent loop consumes their tools under
// `mcp:<server>:<tool>` names through the same policy tier as shell tools.
// Env vars and headers are encrypted at rest. Connections are pooled per
// server and lazily established — a dead server fails its first tool call,
// records last_error, and never blocks registry reads.

export interface McpServerRow {
  id: number;
  name: string;
  transport: 'stdio' | 'http';
  command: string;
  args: string[];
  url: string;
  enabled: number;
  tool_count: number | null;
  last_error: string | null;
  last_seen_at: string | null;
  created_at: string;
}

interface StoredRow {
  id: number;
  name: string;
  transport: string;
  command: string;
  args_json: string;
  url: string;
  env_encrypted: string | null;
  env_iv: string | null;
  env_auth_tag: string | null;
  headers_encrypted: string | null;
  headers_iv: string | null;
  headers_auth_tag: string | null;
  enabled: number;
  last_error: string | null;
  last_seen_at: string | null;
  created_at: string;
}

export const MCP_NAME_PATTERN = /^[a-z0-9][a-z0-9-_]*$/;

function secretJson(decrypted: { encrypted: string | null; iv: string | null; authTag: string | null }): Record<string, string> {
  if (!decrypted.encrypted || !decrypted.iv || !decrypted.authTag) return {};
  try {
    const parsed: unknown = JSON.parse(decrypt(decrypted.encrypted, decrypted.iv, decrypted.authTag));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function sealSecrets(values: Record<string, string> | undefined): { encrypted: string | null; iv: string | null; authTag: string | null } {
  if (!values || Object.keys(values).length === 0) return { encrypted: null, iv: null, authTag: null };
  const sealed = encrypt(JSON.stringify(values));
  return { encrypted: sealed.encrypted, iv: sealed.iv, authTag: sealed.authTag };
}

export interface McpServerInput {
  name: string;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  enabled?: boolean;
}

export function createMcpServer(input: McpServerInput): number {
  validateInput(input);
  const env = sealSecrets(input.env);
  const headers = sealSecrets(input.headers);
  try {
    const row = getDb().prepare(
      `INSERT INTO mcp_servers (name, transport, command, args_json, url, env_encrypted, env_iv, env_auth_tag,
        headers_encrypted, headers_iv, headers_auth_tag, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    ).get(
      input.name, input.transport, input.command ?? '', JSON.stringify(input.args ?? []), input.url ?? '',
      env.encrypted, env.iv, env.authTag, headers.encrypted, headers.iv, headers.authTag,
      input.enabled === false ? 0 : 1,
    ) as { id: number };
    return row.id;
  } catch {
    throw new Error(`MCP server '${input.name}' already exists.`);
  }
}

export function updateMcpServer(id: number, input: Partial<McpServerInput>): void {
  const existing = getMcpServerRow(id);
  if (!existing) throw new Error('MCP server not found');
  if (input.name !== undefined && !MCP_NAME_PATTERN.test(input.name)) throw new Error('Invalid server name.');
  const transport = input.transport ?? (existing.transport as 'stdio' | 'http');
  const merged: McpServerInput = {
    name: input.name ?? existing.name,
    transport,
    command: input.command ?? existing.command,
    args: input.args ?? JSON.parse(existing.args_json) as string[],
    url: input.url ?? existing.url,
  };
  validateInput(merged);
  // Secrets replace wholesale when provided; omitted means "keep stored".
  const env = input.env !== undefined ? sealSecrets(input.env) : null;
  const headers = input.headers !== undefined ? sealSecrets(input.headers) : null;
  getDb().prepare(
    `UPDATE mcp_servers SET name = ?, transport = ?, command = ?, args_json = ?, url = ?,
       env_encrypted = COALESCE(?, env_encrypted), env_iv = COALESCE(?, env_iv), env_auth_tag = COALESCE(?, env_auth_tag),
       headers_encrypted = COALESCE(?, headers_encrypted), headers_iv = COALESCE(?, headers_iv), headers_auth_tag = COALESCE(?, headers_auth_tag),
       enabled = ?, last_error = NULL WHERE id = ?`,
  ).run(
    merged.name, merged.transport, merged.command ?? '', JSON.stringify(merged.args ?? []), merged.url ?? '',
    env?.encrypted ?? null, env?.iv ?? null, env?.authTag ?? null,
    headers?.encrypted ?? null, headers?.iv ?? null, headers?.authTag ?? null,
    input.enabled === undefined ? existing.enabled : (input.enabled ? 1 : 0), id,
  );
  // Config changed under a pooled connection: drop it so the next use
  // reconnects with the new command/url/credentials.
  void dropConnection(id);
}

export function deleteMcpServer(id: number): boolean {
  void dropConnection(id);
  const result = getDb().prepare('DELETE FROM mcp_servers WHERE id = ?').run(id);
  return result.changes > 0;
}

function validateInput(input: McpServerInput): void {
  if (!MCP_NAME_PATTERN.test(input.name)) {
    throw new Error('Invalid server name: lowercase letters, digits, dashes, underscores.');
  }
  if (input.transport === 'stdio') {
    if (!input.command?.trim()) throw new Error('stdio servers need a command.');
  } else if (input.transport === 'http') {
    if (!input.url?.trim()) throw new Error('http servers need a url.');
    try {
      const parsed = new URL(input.url.trim());
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('bad protocol');
    } catch {
      throw new Error('MCP server URL must be http(s).');
    }
  } else {
    throw new Error('transport must be stdio or http.');
  }
}

function getMcpServerRow(id: number): StoredRow | undefined {
  return getDb().prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as StoredRow | undefined;
}

export function getMcpServer(id: number): McpServerRow | null {
  const row = getMcpServerRow(id);
  if (!row) return null;
  return toPublic(row);
}

function toPublic(row: StoredRow): McpServerRow {
  return {
    id: row.id,
    name: row.name,
    transport: row.transport as 'stdio' | 'http',
    command: row.command,
    args: JSON.parse(row.args_json) as string[],
    url: row.url,
    enabled: row.enabled,
    tool_count: toolCountCache.get(row.id) ?? null,
    last_error: row.last_error,
    last_seen_at: row.last_seen_at,
    created_at: row.created_at,
  };
}

export function listMcpServers(): McpServerRow[] {
  const rows = getDb().prepare('SELECT * FROM mcp_servers ORDER BY name').all() as StoredRow[];
  return rows.map(toPublic);
}

// ── Pool ─────────────────────────────────────────────────────────────────────

const pool = new Map<number, Promise<McpClient>>();
const toolCountCache = new Map<number, number | null>();

function recordSuccess(id: number, toolCount: number): void {
  toolCountCache.set(id, toolCount);
  getDb().prepare(
    `UPDATE mcp_servers SET last_error = NULL, last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
  ).run(id);
}

function recordFailure(id: number, err: unknown): void {
  toolCountCache.set(id, null);
  const message = err instanceof Error ? err.message : String(err);
  getDb().prepare('UPDATE mcp_servers SET last_error = ? WHERE id = ?').run(message.slice(0, 500), id);
  pool.delete(id);
}

/** Pooled connection for one server; connects lazily, reconnects on failure. */
export async function mcpConnection(id: number): Promise<McpClient> {
  const existing = pool.get(id);
  if (existing) return existing;
  const task = (async (): Promise<McpClient> => {
    const row = getMcpServerRow(id);
    if (!row) throw new Error('MCP server not found');
    if (!row.enabled) throw new Error(`MCP server '${row.name}' is disabled.`);
    try {
      if (row.transport === 'http') {
        const headers = secretJson({ encrypted: row.headers_encrypted, iv: row.headers_iv, authTag: row.headers_auth_tag });
        return await McpClient.http(row.url, { headers });
      }
      const env = secretJson({ encrypted: row.env_encrypted, iv: row.env_iv, authTag: row.env_auth_tag });
      return await McpClient.stdio(row.command, JSON.parse(row.args_json) as string[], env);
    } catch (err) {
      recordFailure(id, err);
      throw err;
    }
  })();
  pool.set(id, task);
  // A rejected pool entry must not poison later callers.
  task.catch(() => pool.delete(id));
  return task;
}

export async function dropConnection(id: number): Promise<void> {
  const task = pool.get(id);
  pool.delete(id);
  if (!task) return;
  try {
    const client = await task;
    await client.close();
  } catch {
    // Failed connects have nothing to close.
  }
}

/** Test seam: drop every pooled connection. */
export async function __dropAllConnections(): Promise<void> {
  const ids = [...pool.keys()];
  for (const id of ids) await dropConnection(id);
  toolCountCache.clear();
}

// ── Tools ────────────────────────────────────────────────────────────────────

export interface NamespacedMcpTool extends McpToolDef {
  serverId: number;
  serverName: string;
  /** `mcp:<server>:<tool>` — the name the agent loop uses. */
  qualifiedName: string;
}

/** Parse `mcp:<server>:<tool>` back into its parts. */
export function parseQualifiedName(name: string): { server: string; tool: string } | null {
  if (!name.startsWith('mcp:')) return null;
  const rest = name.slice('mcp:'.length);
  const sep = rest.indexOf(':');
  if (sep <= 0 || sep === rest.length - 1) return null;
  return { server: rest.slice(0, sep), tool: rest.slice(sep + 1) };
}

/**
 * Aggregate tools across enabled servers. A failing server contributes
 * nothing (its last_error is recorded) rather than failing the whole list —
 * one dead server must not blind the agent to the healthy ones.
 */
export async function listMcpTools(): Promise<NamespacedMcpTool[]> {
  const db = getDb();
  const rows = db.prepare('SELECT id, name FROM mcp_servers WHERE enabled = 1 ORDER BY name').all() as { id: number; name: string }[];
  const out: NamespacedMcpTool[] = [];
  for (const row of rows) {
    try {
      const client = await mcpConnection(row.id);
      const tools = await client.listTools();
      recordSuccess(row.id, tools.length);
      for (const tool of tools) {
        out.push({
          ...tool,
          serverId: row.id,
          serverName: row.name,
          qualifiedName: `mcp:${row.name}:${tool.name}`,
        });
      }
    } catch (err) {
      recordFailure(row.id, err);
    }
  }
  return out;
}

/** Call one namespaced tool. Throws McpError-flavored messages on failure. */
export async function callMcpTool(qualifiedName: string, args: unknown): Promise<string> {
  const parsed = parseQualifiedName(qualifiedName);
  if (!parsed) throw new Error(`not an MCP tool: ${qualifiedName}`);
  const row = getDb().prepare('SELECT * FROM mcp_servers WHERE name = ?').get(parsed.server) as StoredRow | undefined;
  if (!row) throw new Error(`unknown MCP server: ${parsed.server}`);
  if (!row.enabled) throw new Error(`MCP server '${parsed.server}' is disabled.`);
  const attempt = async (): Promise<string> => {
    const client = await mcpConnection(row.id);
    const result = await client.callTool(parsed.tool, args ?? {});
    return result.content
      .map(block => {
        if (block && typeof block === 'object' && 'text' in block && typeof (block as { text: unknown }).text === 'string') {
          return (block as { text: string }).text;
        }
        return JSON.stringify(block);
      })
      .join('\n');
  };
  try {
    return await attempt();
  } catch {
    // One reconnect: the server may have restarted since the pool connected.
    await dropConnection(row.id);
    try {
      return await attempt();
    } catch (retryErr) {
      recordFailure(row.id, retryErr);
      throw retryErr;
    }
  }
}

/** Connect + list tools without pooling the client (dashboard "test"). */
export async function testMcpServer(id: number): Promise<{ tools: McpToolDef[]; serverInfo: Record<string, unknown> }> {
  const row = getMcpServerRow(id);
  if (!row) throw new Error('MCP server not found');
  let client: McpClient;
  try {
    if (row.transport === 'http') {
      const headers = secretJson({ encrypted: row.headers_encrypted, iv: row.headers_iv, authTag: row.headers_auth_tag });
      client = await McpClient.http(row.url, { headers });
    } else {
      const env = secretJson({ encrypted: row.env_encrypted, iv: row.env_iv, authTag: row.env_auth_tag });
      client = await McpClient.stdio(row.command, JSON.parse(row.args_json) as string[], env);
    }
  } catch (err) {
    recordFailure(id, err);
    throw err;
  }
  try {
    const tools = await client.listTools();
    recordSuccess(id, tools.length);
    return { tools, serverInfo: client.serverInfo };
  } catch (err) {
    recordFailure(id, err);
    throw err;
  } finally {
    await client.close().catch(() => undefined);
  }
}
