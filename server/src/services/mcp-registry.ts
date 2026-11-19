import { z } from 'zod';

// One-click install from the official MCP registry (metadata catalog, not an
// app store: it points at npm/PyPI/Docker packages and hosted endpoints).
// API frozen at v0.1; parsed tolerantly — unknown shapes fail with a message,
// never a crash, and the registry staying in preview is exactly why.

const REGISTRY_BASE = 'https://registry.modelcontextprotocol.io';
const FETCH_TIMEOUT_MS = 15_000;

const envVarSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  required: z.boolean().optional(),
}).passthrough();

const packageSchema = z.object({
  registryType: z.string().optional(),
  registryBaseUrl: z.string().optional(),
  identifier: z.string().optional(),
  version: z.string().optional(),
  transport: z.union([z.string(), z.object({ type: z.string() }).passthrough()]).optional(),
  environmentVariables: z.array(envVarSchema).optional(),
}).passthrough();

const remoteSchema = z.object({
  type: z.string().optional(),
  url: z.string().optional(),
}).passthrough();

const entrySchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  version: z.string().optional(),
  packages: z.array(packageSchema).optional(),
  remotes: z.array(remoteSchema).optional(),
}).passthrough();

export interface RegistryInstallPlan {
  transport: 'stdio' | 'http';
  command: string;
  args: string[];
  url: string;
  /** Env vars the package declares required; the caller must supply values. */
  requiredEnv: Array<{ name: string; description?: string }>;
  description: string;
}

function packageTransport(p: z.infer<typeof packageSchema>): string {
  return typeof p.transport === 'string' ? p.transport : (p.transport?.type ?? '');
}

/** Map one registry package to a stdio command. Null when unrunnable. */
function stdioCommand(p: z.infer<typeof packageSchema>): { command: string; args: string[] } | null {
  const id = p.identifier?.trim();
  if (!id) return null;
  const kind = (p.registryType ?? '').toLowerCase();
  if (kind === 'npm') return { command: 'npx', args: ['-y', p.version ? `${id}@${p.version}` : id] };
  if (kind === 'pypi') return { command: 'uvx', args: [p.version ? `${id}==${p.version}` : id] };
  if (kind === 'docker' || kind === 'oci') return { command: 'docker', args: ['run', '-i', '--rm', p.version ? `${id}:${p.version}` : id] };
  return null;
}

export function planRegistryInstall(entry: unknown): RegistryInstallPlan {
  const parsed = entrySchema.safeParse(entry);
  if (!parsed.success) throw new Error('Registry returned an unrecognized server entry.');
  const { packages = [], remotes = [], description = '' } = parsed.data;

  // Prefer a hosted streamable-http endpoint: no local runtime needed.
  const remote = remotes.find(r => r.type === 'streamable-http' && r.url?.startsWith('http'));
  if (remote?.url) {
    return { transport: 'http', command: '', args: [], url: remote.url, requiredEnv: [], description };
  }

  for (const p of packages) {
    if (packageTransport(p) !== 'stdio') continue;
    const cmd = stdioCommand(p);
    if (!cmd) continue;
    const requiredEnv = (p.environmentVariables ?? [])
      .filter(v => v.required && v.name)
      .map(v => ({ name: v.name, description: v.description }));
    return { transport: 'stdio', command: cmd.command, args: cmd.args, url: '', requiredEnv, description };
  }
  throw new Error('No installable stdio package or streamable-http endpoint in this registry entry.');
}

export interface RegistryEntryMeta {
  entry: z.infer<typeof entrySchema>;
  version: string;
}

const listItemSchema = z.object({
  server: entrySchema.extend({ title: z.string().optional() }),
  _meta: z.object({}).passthrough().optional(),
}).passthrough();

const listResponseSchema = z.object({
  servers: z.array(listItemSchema).optional(),
  metadata: z.object({ nextCursor: z.string().optional() }).passthrough().optional(),
}).passthrough();

export interface RegistrySearchResult {
  name: string;
  title: string;
  description: string;
  version: string;
  isLatest: boolean;
  transports: string[];
}

export interface RegistrySearchPage {
  servers: RegistrySearchResult[];
  nextCursor: string | null;
}

function itemTransports(entry: z.infer<typeof entrySchema>): string[] {
  const out = new Set<string>();
  for (const r of entry.remotes ?? []) {
    if (r.type) out.add(r.type);
  }
  for (const p of entry.packages ?? []) {
    const t = packageTransport(p);
    if (t) out.add(t);
  }
  return [...out];
}

/**
 * Browse/search the registry catalog. Tolerant like the rest of this module:
 * unknown list shapes fail with a message, and entries missing a name are
 * skipped rather than failing the page.
 */
export async function searchRegistry(opts: { q?: string; limit?: number; cursor?: string }): Promise<RegistrySearchPage> {
  const limit = Math.min(50, Math.max(1, opts.limit ?? 20));
  const params = new URLSearchParams({ limit: String(limit) });
  if (opts.q?.trim()) params.set('search', opts.q.trim());
  if (opts.cursor?.trim()) params.set('cursor', opts.cursor.trim());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${REGISTRY_BASE}/v0.1/servers?${params}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Registry request failed with HTTP ${res.status}.`);
    const parsed = listResponseSchema.safeParse(await res.json());
    if (!parsed.success) throw new Error('Registry returned an unrecognized server list.');
    const servers: RegistrySearchResult[] = [];
    for (const item of parsed.data.servers ?? []) {
      const name = item.server.name?.trim();
      if (!name) continue;
      const official = (item._meta?.['io.modelcontextprotocol.registry/official'] ?? {}) as { isLatest?: unknown };
      servers.push({
        name,
        title: item.server.title ?? '',
        description: item.server.description ?? '',
        version: item.server.version ?? '',
        isLatest: official.isLatest === true,
        transports: itemTransports(item.server),
      });
    }
    return { servers, nextCursor: parsed.data.metadata?.nextCursor ?? null };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw new Error('Registry request timed out.');
    throw err instanceof Error ? err : new Error(String(err));
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchRegistryEntry(name: string, version?: string): Promise<RegistryEntryMeta> {
  const tag = (version?.trim() || 'latest').replace(/[^a-zA-Z0-9._-]/g, '');
  const url = `${REGISTRY_BASE}/v0.1/servers/${encodeURIComponent(name.trim())}/versions/${tag}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (res.status === 404) throw new Error(`No registry server named '${name}'.`);
    if (!res.ok) throw new Error(`Registry request failed with HTTP ${res.status}.`);
    const entry = entrySchema.parse(await res.json());
    return { entry, version: entry.version ?? tag };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw new Error('Registry request timed out.');
    throw err instanceof Error ? err : new Error(String(err));
  } finally {
    clearTimeout(timer);
  }
}

/** Local display name from a reverse-DNS registry name: last segment. */
export function defaultLocalName(registryName: string): string {
  const tail = registryName.trim().split('/').pop() ?? registryName.trim();
  return tail.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'mcp-server';
}
