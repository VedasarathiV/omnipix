// Dashboard-authenticated control of scheduled security scans: run a scan
// on demand, inspect history, and tune the nightly job. Needs
// OMNIPIX_DASHBOARD_TOKEN / --token like `agent` and `eval`.

export interface ScanCommandOptions {
  url: string;
  args: string[];
  token?: string;
  schedule?: string;
  timeoutMs?: number;
  dryRun: boolean;
}

export function scanHelp(): string {
  return [
    'Security scans (dashboard authentication):',
    '  omnipix scan run',
    '  omnipix scan list',
    '  omnipix scan show <id>',
    '  omnipix scan enable',
    '  omnipix scan disable',
    '  omnipix scan config --schedule CRON',
    '',
    'Options: --url URL, --token TOKEN, --timeout MS (default 30000)',
    'Scans grep every agent workspace for leaked secrets and risky code;',
    'only new findings notify.',
  ].join('\n');
}

interface ScanRow {
  id: number;
  trigger: string;
  status: string;
  workspace_count: number;
  finding_count: number;
  new_count: number;
  error: string | null;
  finished_at: string;
}

interface FindingRow {
  id: number;
  workspace: string;
  pattern: string;
  severity: string;
  file: string;
  line: number;
  excerpt: string;
}

interface ScanSettings {
  enabled: boolean;
  schedule: string;
  nextRunAt: string | null;
}

function gatewayRoot(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('--url must be an HTTP(S) gateway URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('--url must be an HTTP(S) URL without credentials, a query, or a fragment');
  }
  return url.href.replace(/\/+$/, '').replace(/\/v1$/i, '');
}

function setup(options: ScanCommandOptions): { request: <T>(path: string, method?: string, body?: unknown) => Promise<T> } {
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

export async function runScan(
  options: ScanCommandOptions,
  write: (line: string) => void = line => process.stdout.write(`${line}\n`),
): Promise<number> {
  const [action, idArg, ...extra] = options.args;
  if (!action || !['run', 'list', 'show', 'enable', 'disable', 'config'].includes(action)) {
    throw new Error(`Expected scan run, list, show, enable, disable, or config.\n\n${scanHelp()}`);
  }
  if (options.dryRun) throw new Error('--dry-run is not supported by scan; no request was made');
  const { request } = setup(options);

  if (action === 'run') {
    if (idArg !== undefined || extra.length) throw new Error(`Invalid arguments for scan run.\n\n${scanHelp()}`);
    const { scan } = await request<{ scan: ScanRow }>('/api/agents/scans', 'POST');
    write(`scan ${scan.id} (${scan.status}): ${scan.workspace_count} workspaces, ${scan.finding_count} findings, ${scan.new_count} new`);
    return 0;
  }

  if (action === 'list') {
    if (idArg !== undefined || extra.length) throw new Error(`Invalid arguments for scan list.\n\n${scanHelp()}`);
    const { scans, settings } = await request<{ scans: ScanRow[]; settings: ScanSettings }>('/api/agents/scans');
    write(`scheduled scans ${settings.enabled ? `enabled (${settings.schedule})` : 'disabled'}`);
    for (const scan of scans) {
      write(`${scan.id}\t${scan.status}\t${scan.trigger}\t${scan.workspace_count} workspaces\t${scan.finding_count} findings\t${scan.new_count} new`);
    }
    return 0;
  }

  if (action === 'config') {
    if (idArg !== undefined || extra.length) throw new Error(`Invalid arguments for scan config.\n\n${scanHelp()}`);
    const schedule = options.schedule?.trim();
    if (!schedule) throw new Error('scan config needs --schedule CRON');
    const { settings } = await request<{ settings: ScanSettings }>('/api/agents/scans-settings', 'PATCH', { schedule });
    write(`scan schedule: ${settings.schedule}${settings.enabled ? '' : ' (disabled)'}`);
    return 0;
  }

  if (action === 'enable' || action === 'disable') {
    if (idArg !== undefined || extra.length) throw new Error(`Invalid arguments for scan ${action}.\n\n${scanHelp()}`);
    const { settings } = await request<{ settings: ScanSettings }>(
      '/api/agents/scans-settings', 'PATCH', { enabled: action === 'enable' },
    );
    write(`scheduled scans ${settings.enabled ? 'enabled' : 'disabled'} (${settings.schedule})`);
    return 0;
  }

  const id = Number(idArg);
  if (!idArg || !Number.isSafeInteger(id) || id <= 0 || extra.length) {
    throw new Error(`scan show needs a positive scan id.\n\n${scanHelp()}`);
  }
  const { scan, findings } = await request<{ scan: ScanRow; findings: FindingRow[] }>(`/api/agents/scans/${id}`);
  write(`scan ${scan.id} (${scan.status}): ${scan.trigger}, ${scan.finding_count} findings`);
  for (const finding of findings) {
    write(`  ${finding.severity}\t${finding.workspace}/${finding.file}:${finding.line}\t[${finding.pattern}]\t${finding.excerpt}`);
  }
  return 0;
}
