import { spawn, type ChildProcess } from 'node:child_process';

// MCP client: the gateway calling OUT to MCP servers (Phase 2). Speaks
// JSON-RPC 2.0 over stdio (local servers: filesystem, git, sqlite) and
// Streamable HTTP (remote servers), per the Model Context Protocol.
//
// Lifecycle: initialize (with protocol-version fallback) →
// notifications/initialized → tools/list → tools/call. One client instance
// per server connection; the pool in services/mcp-servers.ts owns lifetimes.
// Stdio servers log to stderr by spec — only stdout is parsed as protocol.

export const MCP_PROTOCOL_LATEST = '2025-06-18';
export const MCP_PROTOCOL_FALLBACK = '2024-11-05';
export const DEFAULT_MCP_TIMEOUT_MS = 30_000;

export interface McpToolDef {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface McpCallResult {
  content: unknown[];
  isError?: boolean;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export class McpError extends Error {
  code: number;
  constructor(message: string, code = -32000) {
    super(message);
    this.name = 'McpError';
    this.code = code;
  }
}

interface Transport {
  send(message: string): void;
  close(): void;
  onMessage: ((message: string) => void) | null;
  onClose: (() => void) | null;
}

function createStdioTransport(command: string, args: string[], env?: Record<string, string>): Transport & { child: ChildProcess } {
  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const transport = {
    child,
    onMessage: null as ((message: string) => void) | null,
    onClose: null as (() => void) | null,
    send(message: string): void {
      if (!child.stdin || child.stdin.destroyed) throw new McpError('MCP server stdin is closed');
      child.stdin.write(`${message}\n`);
    },
    close(): void {
      try {
        child.stdin?.end();
      } catch {
        // Already closed.
      }
      const killer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // Already dead.
        }
      }, 2000);
      if (typeof killer.unref === 'function') killer.unref();
      try {
        child.kill('SIGTERM');
      } catch {
        // Already dead.
      }
    },
  };
  let buffer = '';
  child.stdout?.on('data', (data: Buffer) => {
    buffer += data.toString('utf8');
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) transport.onMessage?.(trimmed);
    }
  });
  // stderr is server logging by spec — drain it so a chatty server cannot
  // block on a full pipe, but never parse it as protocol.
  child.stderr?.resume();
  child.on('close', () => transport.onClose?.());
  child.on('error', () => transport.onClose?.());
  return transport;
}

export interface McpClientOptions {
  timeoutMs?: number;
  /** Extra headers for Streamable HTTP (auth). Never logged. */
  headers?: Record<string, string>;
}

export class McpClient {
  protocolVersion = '';
  serverInfo: Record<string, unknown> = {};
  serverCapabilities: Record<string, unknown> = {};

  private transport: Transport | null;
  private httpUrl: string | null;
  private headers: Record<string, string>;
  private timeoutMs: number;
  private nextId = 1;
  private pending = new Map<number | string, {
    resolve: (value: unknown) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private closed = false;

  private constructor(transport: Transport | null, httpUrl: string | null, opts?: McpClientOptions) {
    this.transport = transport;
    this.httpUrl = httpUrl;
    this.headers = opts?.headers ?? {};
    this.timeoutMs = opts?.timeoutMs ?? DEFAULT_MCP_TIMEOUT_MS;
    if (transport) {
      transport.onMessage = message => this.handleMessage(message);
      transport.onClose = () => this.handleClose();
    }
  }

  /** Connect to a local server over stdio. The process is owned by this client. */
  static async stdio(command: string, args: string[], env?: Record<string, string>, opts?: McpClientOptions): Promise<McpClient> {
    const client = new McpClient(createStdioTransport(command, args, env), null, opts);
    try {
      await client.initialize();
    } catch (err) {
      await client.close().catch(() => undefined);
      throw err;
    }
    return client;
  }

  /** Connect to a remote server over Streamable HTTP. Stateless per request. */
  static async http(url: string, opts?: McpClientOptions): Promise<McpClient> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new McpError(`invalid MCP server URL: ${url}`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new McpError(`MCP server URL must be http(s): ${url}`);
    }
    const client = new McpClient(null, parsed.href, opts);
    await client.initialize();
    return client;
  }

  private async initialize(): Promise<void> {
    const attempt = async (version: string): Promise<{ protocolVersion: string; capabilities?: unknown; serverInfo?: unknown }> => {
      const result = await this.request('initialize', {
        protocolVersion: version,
        capabilities: {},
        clientInfo: { name: 'omnipix', version: '1.0.0' },
      }) as { protocolVersion: string; capabilities?: unknown; serverInfo?: unknown };
      return result;
    };
    let hello: { protocolVersion: string; capabilities?: unknown; serverInfo?: unknown };
    try {
      hello = await attempt(MCP_PROTOCOL_LATEST);
    } catch (err) {
      // Older servers reject unknown versions: retry once on the widely
      // supported baseline before giving up.
      if (err instanceof McpError) {
        hello = await attempt(MCP_PROTOCOL_FALLBACK);
      } else {
        throw err;
      }
    }
    this.protocolVersion = typeof hello.protocolVersion === 'string' ? hello.protocolVersion : '';
    this.serverCapabilities = (hello.capabilities ?? {}) as Record<string, unknown>;
    this.serverInfo = (hello.serverInfo ?? {}) as Record<string, unknown>;
    this.notify('notifications/initialized', {});
  }

  async listTools(): Promise<McpToolDef[]> {
    const result = await this.request('tools/list', {}) as { tools?: Array<{ name: string; description?: string; inputSchema?: unknown }> };
    if (!Array.isArray(result.tools)) throw new McpError('MCP server returned a malformed tools/list result');
    return result.tools.map(tool => ({
      name: String(tool.name),
      description: typeof tool.description === 'string' ? tool.description : undefined,
      inputSchema: (tool.inputSchema ?? { type: 'object' }) as Record<string, unknown>,
    }));
  }

  async callTool(name: string, args: unknown): Promise<McpCallResult> {
    const result = await this.request('tools/call', { name, arguments: args ?? {} }) as { content?: unknown; isError?: unknown };
    const content = Array.isArray(result.content) ? result.content : [result.content ?? null];
    return { content, isError: result.isError === true };
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new McpError('MCP client closed'));
    }
    this.pending.clear();
    this.transport?.close();
    this.transport = null;
  }

  private request(method: string, params: unknown): Promise<unknown> {
    if (this.httpUrl) return this.httpRequest(method, params);
    return this.transportRequest(method, params);
  }

  private transportRequest(method: string, params: unknown): Promise<unknown> {
    if (!this.transport || this.closed) return Promise.reject(new McpError('MCP client is closed'));
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new McpError(`MCP request timed out: ${method}`));
      }, this.timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.transport!.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(err instanceof Error ? err : new McpError(String(err)));
      }
    });
  }

  private async httpRequest(method: string, params: unknown): Promise<unknown> {
    if (this.closed) throw new McpError('MCP client is closed');
    const id = this.nextId++;
    const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    let response: Response;
    try {
      response = await fetch(this.httpUrl!, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...this.headers,
        },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'error',
      });
    } catch {
      throw new McpError(`MCP HTTP request failed: ${method}`);
    }
    if (!response.ok) throw new McpError(`MCP HTTP error ${response.status}: ${method}`);
    const contentType = response.headers.get('content-type') ?? '';
    // Streamable HTTP may answer inline JSON or an SSE stream carrying the
    // single JSON-RPC response; accept both.
    if (contentType.includes('text/event-stream') && response.body) {
      const text = await response.text();
      for (const frame of text.split('\n\n')) {
        const line = frame.split('\n').find(l => l.startsWith('data:'));
        if (!line || line.slice(5).trim() === '[DONE]') continue;
        try {
          const parsed = JSON.parse(line.slice(5).trim()) as JsonRpcResponse;
          if (parsed.id === id) return this.unwrap(parsed, method);
        } catch {
          // Partial frame — keep scanning.
        }
      }
      throw new McpError(`MCP SSE response carried no answer: ${method}`);
    }
    const parsed = await response.json().catch(() => null) as JsonRpcResponse | null;
    if (!parsed || typeof parsed !== 'object') throw new McpError(`MCP HTTP returned non-JSON: ${method}`);
    return this.unwrap(parsed, method);
  }

  private unwrap(response: JsonRpcResponse, method: string): unknown {
    if (response.error) {
      throw new McpError(`MCP error (${method}): ${response.error.message}`, response.error.code);
    }
    return response.result;
  }

  private notify(method: string, params: unknown): void {
    if (this.httpUrl || !this.transport || this.closed) return;
    try {
      this.transport.send(JSON.stringify({ jsonrpc: '2.0', method, params }));
    } catch {
      // Notifications are fire-and-forget by design.
    }
  }

  private handleMessage(raw: string): void {
    let parsed: JsonRpcResponse;
    try {
      parsed = JSON.parse(raw) as JsonRpcResponse;
    } catch {
      return; // Non-JSON on stdout — ignore, never crash the client.
    }
    if (parsed.id === undefined || parsed.id === null) return; // Notification — nothing subscribes yet.
    const pending = this.pending.get(parsed.id);
    if (!pending) return;
    this.pending.delete(parsed.id);
    clearTimeout(pending.timer);
    if (parsed.error) {
      pending.reject(new McpError(`MCP error: ${parsed.error.message}`, parsed.error.code));
    } else {
      pending.resolve(parsed.result);
    }
  }

  private handleClose(): void {
    if (this.closed) return;
    this.closed = true;
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new McpError('MCP server connection closed'));
    }
    this.pending.clear();
  }
}
