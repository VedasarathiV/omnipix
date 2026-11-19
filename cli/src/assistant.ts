// Dashboard-authenticated control of long-term memory and scheduled
// automations. Needs OMNIPIX_DASHBOARD_TOKEN / --token like the other
// dashboard commands.

export interface AssistantCommandOptions {
  url: string;
  args: string[];
  token?: string;
  key?: string;
  value?: string;
  scope?: string;
  project?: string;
  importance?: number;
  name?: string;
  goal?: string;
  schedule?: string;
  model?: string;
  timeoutMs?: number;
  dryRun: boolean;
}

export function memoryHelp(): string {
  return [
    'Long-term memory (dashboard authentication):',
    '  omnipix memory list [--scope user|project|entity] [--project KEY]',
    '  omnipix memory add --key K --value V [--scope user|project|entity] [--project KEY] [--importance 0..1]',
    '  omnipix memory delete <id>',
    '  omnipix memory ingest <url> --project KEY',
    '  omnipix memory docs [--project KEY]',
    '  omnipix memory undoc <url> --project KEY',
    '',
    'Options: --url URL, --token TOKEN, --timeout MS (default 30000)',
    'Values are PII-scrubbed at write time.',
  ].join('\n');
}

export function automateHelp(): string {
  return [
    'Scheduled automations (dashboard authentication):',
    '  omnipix automate list',
    '  omnipix automate add --name N --goal G [--schedule CRON] [--model ID]',
    '  omnipix automate run <name>',
    '  omnipix automate enable <name>',
    '  omnipix automate disable <name>',
    '  omnipix automate remove <name>',
    '',
    'Options: --url URL, --token TOKEN, --timeout MS (default 30000)',
    'A schedule never fires until one manual run completed first.',
  ].join('\n');
}

interface MemoryRow {
  id: number;
  scope: string;
  project_key: string;
  key: string;
  value: string;
  score: number;
}

interface IngestedDoc {
  project_key: string;
  source_url: string;
  title: string;
  chunks: number;
  updated_at: string;
}

interface AutomationRow {
  id: number;
  name: string;
  goal: string;
  schedule: string;
  enabled: number;
  reviewed: number;
  last_status: string | null;
  next_run_at: string | null;
}

function gatewayRoot(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('--url must be an HTTP(S) gateway URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('--url must be an HTTP(S) URL without credentials, a query, or a fragment');
  }
  return url.href.replace(/\/+$/, '').replace(/\/v1$/i, '');
}

function setup(options: AssistantCommandOptions): { request: <T>(path: string, method?: string, body?: unknown) => Promise<T> } {
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

export async function runMemory(
  options: AssistantCommandOptions,
  write: (line: string) => void = line => process.stdout.write(`${line}\n`),
): Promise<number> {
  const [action, idArg, ...extra] = options.args;
  if (!action || !['list', 'add', 'delete', 'ingest', 'docs', 'undoc'].includes(action)) {
    throw new Error(`Expected memory list, add, delete, ingest, docs, or undoc.\n\n${memoryHelp()}`);
  }
  if (options.dryRun) throw new Error('--dry-run is not supported by memory; no request was made');
  const { request } = setup(options);

  if (action === 'ingest' || action === 'undoc') {
    const url = idArg?.trim();
    const project = options.project?.trim();
    if (!url || extra.length) throw new Error(`memory ${action} needs a URL.\n\n${memoryHelp()}`);
    if (!project) throw new Error(`memory ${action} needs --project KEY`);
    if (action === 'ingest') {
      const { doc } = await request<{ doc: { title: string; chunks: number; replaced: boolean } }>('/api/memories/ingest', 'POST', { url, project });
      write(`ingested ${doc.chunks} chunks from ${url}${doc.title ? ` (${doc.title})` : ''}${doc.replaced ? ' [replaced]' : ''}`);
      return 0;
    }
    const params = new URLSearchParams({ project, url });
    const { chunks } = await request<{ chunks: number }>(`/api/memories/docs?${params}`, 'DELETE');
    write(`deleted ${url} (${chunks} chunks)`);
    return 0;
  }

  if (action === 'docs') {
    if (idArg !== undefined || extra.length) throw new Error(`Invalid arguments for memory docs.\n\n${memoryHelp()}`);
    const query = options.project?.trim() ? `?project=${encodeURIComponent(options.project.trim())}` : '';
    const { docs } = await request<{ docs: IngestedDoc[] }>(`/api/memories/docs${query}`);
    for (const doc of docs) {
      write(`${doc.project_key}\t${doc.chunks} chunks\t${doc.title || '(untitled)'}\t${doc.source_url}`);
    }
    return 0;
  }

  if (action === 'list') {
    if (idArg !== undefined || extra.length) throw new Error(`Invalid arguments for memory list.\n\n${memoryHelp()}`);
    if (options.scope !== undefined && options.scope !== 'user' && options.scope !== 'project' && options.scope !== 'entity') {
      throw new Error('--scope must be user, project, or entity');
    }
    const params = new URLSearchParams();
    if (options.scope) params.set('scope', options.scope);
    if (options.project) params.set('project', options.project);
    const query = params.size ? `?${params}` : '';
    const { memories } = await request<{ memories: MemoryRow[] }>(`/api/memories${query}`);
    for (const memory of memories) {
      write(`${memory.id}\t${memory.scope}${memory.scope === 'project' ? `:${memory.project_key}` : ''}\t${memory.key}\t${memory.value}\t${memory.score.toFixed(2)}`);
    }
    return 0;
  }

  if (action === 'add') {
    if (idArg !== undefined || extra.length) throw new Error(`Invalid arguments for memory add.\n\n${memoryHelp()}`);
    // --key also exists for provider keys; under memory it is the memory key.
    const key = options.key?.trim();
    const value = options.value?.trim();
    if (!key) throw new Error('memory add needs --key K');
    if (!value) throw new Error('memory add needs --value V');
    if (options.scope !== undefined && options.scope !== 'user' && options.scope !== 'project' && options.scope !== 'entity') {
      throw new Error('--scope must be user, project, or entity');
    }
    const { memory, redactions } = await request<{ memory: MemoryRow; redactions: number }>('/api/memories', 'POST', {
      key,
      value,
      scope: options.scope,
      project: options.project,
      importance: options.importance,
    });
    write(`remembered ${memory.key} (id ${memory.id})${redactions ? `, ${redactions} PII span(s) redacted` : ''}`);
    return 0;
  }

  const id = Number(idArg);
  if (!idArg || !Number.isSafeInteger(id) || id <= 0 || extra.length) {
    throw new Error(`memory delete needs a positive memory id.\n\n${memoryHelp()}`);
  }
  await request(`/api/memories/${id}`, 'DELETE');
  write(`forgot memory ${id}`);
  return 0;
}

export async function runAutomate(
  options: AssistantCommandOptions,
  write: (line: string) => void = line => process.stdout.write(`${line}\n`),
): Promise<number> {
  const [action, nameArg, ...extra] = options.args;
  if (!action || !['list', 'add', 'run', 'enable', 'disable', 'remove'].includes(action)) {
    throw new Error(`Expected automate list, add, run, enable, disable, or remove.\n\n${automateHelp()}`);
  }
  if (options.dryRun) throw new Error('--dry-run is not supported by automate; no request was made');
  const { request } = setup(options);

  if (action === 'list') {
    if (nameArg !== undefined || extra.length) throw new Error(`Invalid arguments for automate list.\n\n${automateHelp()}`);
    const { automations } = await request<{ automations: AutomationRow[] }>('/api/automations');
    for (const automation of automations) {
      write(`${automation.name}\t${automation.enabled ? 'enabled' : 'disabled'}\t${automation.reviewed ? 'reviewed' : 'unreviewed'}\t${automation.schedule || '(manual)'}\t${automation.last_status ?? '-'}`);
    }
    return 0;
  }

  if (action === 'add') {
    if (nameArg !== undefined || extra.length) throw new Error(`Invalid arguments for automate add.\n\n${automateHelp()}`);
    if (!options.name?.trim()) throw new Error('automate add needs --name N');
    if (!options.goal?.trim()) throw new Error('automate add needs --goal G');
    const { automation } = await request<{ automation: AutomationRow }>('/api/automations', 'POST', {
      name: options.name.trim(),
      goal: options.goal.trim(),
      schedule: options.schedule,
      model: options.model,
    });
    write(`added ${automation.name} (id ${automation.id})`);
    return 0;
  }

  if (!nameArg || extra.length) throw new Error(`automate ${action} needs an automation name.\n\n${automateHelp()}`);
  const { automations } = await request<{ automations: AutomationRow[] }>('/api/automations');
  const automation = automations.find(a => a.name === nameArg);
  if (!automation) throw new Error(`Unknown automation: ${nameArg}`);
  if (action === 'remove') {
    await request(`/api/automations/${automation.id}`, 'DELETE');
    write(`deleted ${nameArg}`);
    return 0;
  }
  if (action === 'enable' || action === 'disable') {
    const updated = await request<{ automation: AutomationRow }>(
      `/api/automations/${automation.id}`, 'PATCH', { enabled: action === 'enable' },
    );
    write(`${nameArg}: ${updated.automation.enabled ? 'enabled' : 'disabled'}`);
    return 0;
  }
  const { run_id } = await request<{ run_id: number }>(`/api/automations/${automation.id}/run`, 'POST');
  write(`${nameArg}: run ${run_id} started`);
  return 0;
}
