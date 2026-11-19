// Dashboard-authenticated control of content guardrails and the response
// cache. Needs OMNIPIX_DASHBOARD_TOKEN / --token like the other
// dashboard-authenticated commands.

export interface GuardCommandOptions {
  url: string;
  args: string[];
  token?: string;
  inbound?: string;
  outbound?: string;
  patterns?: string;
  threshold?: number;
  timeoutMs?: number;
  dryRun: boolean;
}

export function guardHelp(): string {
  return [
    'Content guardrails (dashboard authentication):',
    '  omnipix guard status',
    '  omnipix guard set [--inbound off|redact|block] [--outbound off|redact] [--patterns a,b]',
    '',
    'Options: --url URL, --token TOKEN, --timeout MS (default 30000)',
    'set with no knobs reports the current state without changing anything.',
  ].join('\n');
}

export function cacheHelp(): string {
  return [
    'Response cache (dashboard authentication):',
    '  omnipix cache stats',
    '  omnipix cache set [--threshold 0..1]',
    '  omnipix cache flush',
    '',
    'Options: --url URL, --token TOKEN, --timeout MS (default 30000)',
    'Threshold 0 disables the semantic near-duplicate tier; 0.9 is conservative.',
  ].join('\n');
}

interface GuardState {
  inbound: string;
  outbound: string;
  blockedPatterns: string[];
  stats: { inboundRedactions: number; inboundBlocks: number; outboundRedactions: number };
}

interface CacheStats {
  enabled: boolean;
  entries: number;
  hitRate: number;
  lookupHits: number;
  lookupMisses: number;
  semanticHits: number;
  semanticThreshold: number;
  savedTokens: number;
}

function gatewayRoot(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('--url must be an HTTP(S) gateway URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('--url must be an HTTP(S) URL without credentials, a query, or a fragment');
  }
  return url.href.replace(/\/+$/, '').replace(/\/v1$/i, '');
}

function setup(options: GuardCommandOptions): { request: <T>(path: string, method?: string, body?: unknown) => Promise<T> } {
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

function printGuard(state: GuardState, write: (line: string) => void): void {
  write(`inbound: ${state.inbound}`);
  write(`outbound: ${state.outbound}`);
  write(`patterns: ${state.blockedPatterns.length === 0 ? '(none)' : state.blockedPatterns.join(', ')}`);
  write(`stats: ${state.stats.inboundBlocks} blocked, ${state.stats.inboundRedactions} inbound redactions, ${state.stats.outboundRedactions} outbound redactions`);
}

export async function runGuard(
  options: GuardCommandOptions,
  write: (line: string) => void = line => process.stdout.write(`${line}\n`),
): Promise<number> {
  const [action, ...extra] = options.args;
  if (!action || !['status', 'set'].includes(action)) {
    throw new Error(`Expected guard status or set.\n\n${guardHelp()}`);
  }
  if (extra.length) throw new Error(`Invalid arguments for guard ${action}.\n\n${guardHelp()}`);
  if (options.dryRun) throw new Error('--dry-run is not supported by guard; no request was made');
  const { request } = setup(options);

  if (action === 'status') {
    printGuard(await request<GuardState>('/api/settings/content-guard'), write);
    return 0;
  }

  const body: Record<string, unknown> = {};
  if (options.inbound !== undefined) {
    if (!['off', 'redact', 'block'].includes(options.inbound)) throw new Error('--inbound must be off, redact, or block');
    body.inbound = options.inbound;
  }
  if (options.outbound !== undefined) {
    if (!['off', 'redact'].includes(options.outbound)) throw new Error('--outbound must be off or redact');
    body.outbound = options.outbound;
  }
  if (options.patterns !== undefined) {
    body.blockedPatterns = options.patterns.split(',').map(part => part.trim()).filter(Boolean);
  }
  printGuard(await request<GuardState>(
    '/api/settings/content-guard',
    Object.keys(body).length === 0 ? 'GET' : 'PUT',
    Object.keys(body).length === 0 ? undefined : body,
  ), write);
  return 0;
}

export async function runCache(
  options: GuardCommandOptions,
  write: (line: string) => void = line => process.stdout.write(`${line}\n`),
): Promise<number> {
  const [action, ...extra] = options.args;
  if (!action || !['stats', 'set', 'flush'].includes(action)) {
    throw new Error(`Expected cache stats, set, or flush.\n\n${cacheHelp()}`);
  }
  if (extra.length) throw new Error(`Invalid arguments for cache ${action}.\n\n${cacheHelp()}`);
  if (options.dryRun) throw new Error('--dry-run is not supported by cache; no request was made');
  const { request } = setup(options);

  if (action === 'stats') {
    const stats = await request<CacheStats>('/api/cache/stats');
    write(`enabled: ${stats.enabled}`);
    write(`entries: ${stats.entries}`);
    write(`hit rate: ${(stats.hitRate * 100).toFixed(1)}% (${stats.lookupHits} hits, ${stats.lookupMisses} misses)`);
    write(`semantic hits: ${stats.semanticHits} (threshold ${stats.semanticThreshold})`);
    write(`tokens saved: ${stats.savedTokens}`);
    return 0;
  }

  if (action === 'flush') {
    const { cleared } = await request<{ cleared: number }>('/api/cache', 'DELETE');
    write(`cleared ${cleared} entries`);
    return 0;
  }

  if (options.threshold === undefined) throw new Error('cache set needs --threshold 0..1');
  const { semanticThreshold } = await request<{ semanticThreshold: number }>(
    '/api/cache/config', 'PUT', { semanticThreshold: options.threshold },
  );
  write(`semantic threshold: ${semanticThreshold}`);
  return 0;
}
