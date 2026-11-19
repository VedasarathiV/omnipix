// Dashboard-authenticated control of the arena eval harness: run suites,
// inspect history, and print safety scorecards. Needs
// OMNIPIX_DASHBOARD_TOKEN / --token like `keys` and `agent`.

export interface EvalCommandOptions {
  url: string;
  args: string[];
  token?: string;
  suite?: string;
  models?: string;
  timeoutMs?: number;
  dryRun: boolean;
}

export function evalHelp(): string {
  return [
    'Arena evaluations (dashboard authentication):',
    '  omnipix eval suites',
    '  omnipix eval recipes',
    '  omnipix eval run --suite NAME --models a,b',
    '  omnipix eval list',
    '  omnipix eval show <id>',
    '  omnipix eval scorecards',
    '',
    'Options: --url URL, --token TOKEN, --timeout MS (default 30000)',
    'run follows the eval to completion and exits 1 when it errors.',
  ].join('\n');
}

interface ItemResult {
  id: string;
  pass: boolean;
  error?: string;
  checks: Array<{ type: string; pass: boolean; detail: string }>;
  agentRunId?: number;
  agentStatus?: string;
}

interface ModelResult {
  model: string;
  displayName: string;
  platform: string;
  passed: number;
  total: number;
  items: ItemResult[];
}

interface EvalRun {
  id: number;
  suite: string;
  models: string[];
  status: 'running' | 'done' | 'error';
  error: string | null;
  results: ModelResult[];
}

interface SuiteRow {
  name: string;
  description: string;
  items: unknown[];
  builtin: number;
}

interface Scorecard {
  model: string;
  displayName: string;
  platform: string;
  runs: number;
  passed: number;
  total: number;
  passRate: number;
  suites: Record<string, { runs: number; passed: number; total: number }>;
}

function gatewayRoot(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('--url must be an HTTP(S) gateway URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('--url must be an HTTP(S) URL without credentials, a query, or a fragment');
  }
  return url.href.replace(/\/+$/, '').replace(/\/v1$/i, '');
}

function setup(options: EvalCommandOptions): { request: <T>(path: string, method?: string, body?: unknown) => Promise<T> } {
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

export async function runEval(
  options: EvalCommandOptions,
  write: (line: string) => void = line => process.stdout.write(`${line}\n`),
  sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
): Promise<number> {
  const [action, idArg, ...extra] = options.args;
  if (!action || !['suites', 'recipes', 'run', 'list', 'show', 'scorecards'].includes(action)) {
    throw new Error(`Expected eval suites, recipes, run, list, show, or scorecards.\n\n${evalHelp()}`);
  }
  if (options.dryRun) throw new Error('--dry-run is not supported by eval; no request was made');
  const { request } = setup(options);

  if (action === 'suites') {
    if (idArg !== undefined || extra.length) throw new Error(`Invalid arguments for eval suites.\n\n${evalHelp()}`);
    const { suites } = await request<{ suites: SuiteRow[] }>('/api/arena/suites');
    for (const suite of suites) {
      write(`${suite.name}\t${suite.items.length} checks\t${suite.builtin ? 'built-in' : 'custom'}\t${suite.description}`);
    }
    return 0;
  }

  if (action === 'recipes') {
    if (idArg !== undefined || extra.length) throw new Error(`Invalid arguments for eval recipes.\n\n${evalHelp()}`);
    const { recipes } = await request<{ recipes: Array<{ name: string; description: string; commands: string[] }> }>('/api/arena/verify-recipes');
    for (const recipe of recipes) {
      write(`${recipe.name}\t${recipe.commands.join(' && ')}\t${recipe.description}`);
    }
    return 0;
  }

  if (action === 'run') {
    if (idArg !== undefined || extra.length) throw new Error(`Invalid arguments for eval run.\n\n${evalHelp()}`);
    const suite = options.suite?.trim();
    const models = options.models?.split(',').map(part => part.trim()).filter(Boolean) ?? [];
    if (!suite) throw new Error('eval run needs --suite NAME');
    if (models.length === 0) throw new Error('eval run needs --models a,b');
    const created = await request<EvalRun>('/api/arena/evals', 'POST', { suite, models });
    write(`eval ${created.id} (${created.status})`);
    for (let polls = 0; polls < 600; polls += 1) {
      const run = await request<EvalRun>(`/api/arena/evals/${created.id}`);
      if (run.status !== 'running') {
        for (const result of run.results) {
          write(`${result.displayName}\t${result.passed}/${result.total}`);
        }
        if (run.error) write(`error: ${run.error}`);
        return run.status === 'done' ? 0 : 1;
      }
      await sleep(2000);
    }
    throw new Error(`eval ${created.id} did not finish after 20 minutes of polling`);
  }

  if (action === 'list') {
    if (idArg !== undefined || extra.length) throw new Error(`Invalid arguments for eval list.\n\n${evalHelp()}`);
    const { evals } = await request<{ evals: EvalRun[] }>('/api/arena/evals?limit=20');
    for (const run of evals) {
      const score = run.results.map(r => `${r.model} ${r.passed}/${r.total}`).join(', ');
      write(`${run.id}\t${run.status}\t${run.suite}\t${score}`);
    }
    return 0;
  }

  if (action === 'scorecards') {
    if (idArg !== undefined || extra.length) throw new Error(`Invalid arguments for eval scorecards.\n\n${evalHelp()}`);
    const { scorecards } = await request<{ scorecards: Scorecard[] }>('/api/arena/scorecards');
    for (const card of scorecards) {
      write(`${card.displayName}\t${(card.passRate * 100).toFixed(1)}%\t${card.passed}/${card.total}\t${card.runs} runs`);
    }
    return 0;
  }

  const id = Number(idArg);
  if (!idArg || !Number.isSafeInteger(id) || id <= 0 || extra.length) {
    throw new Error(`eval show needs a positive eval id.\n\n${evalHelp()}`);
  }
  const run = await request<EvalRun>(`/api/arena/evals/${id}`);
  write(`eval ${run.id} (${run.status}): ${run.suite}`);
  for (const result of run.results) {
    write(`${result.displayName}\t${result.passed}/${result.total}`);
    for (const item of result.items ?? []) {
      const agent = item.agentRunId != null ? ` agent #${item.agentRunId}${item.agentStatus ? ` (${item.agentStatus})` : ''}` : '';
      const detail = item.error ?? item.checks.map(c => c.detail).join('; ');
      write(`  ${item.pass ? 'PASS' : 'FAIL'}\t${item.id}${agent}\t${detail}`.trimEnd());
    }
  }
  if (run.error) write(`error: ${run.error}`);
  return 0;
}
