// Dashboard-authenticated control of the gateway's agent runtime: start and
// follow agent runs, and manage the skills registry. Like `keys`, these
// commands need OMNIPIX_DASHBOARD_TOKEN / --token — the unified API key is
// not dashboard authentication.
import { readFileSync } from 'node:fs';

export interface AgentCommandOptions {
  url: string;
  args: string[];
  token?: string;
  model?: string;
  goal?: string;
  tools?: string;
  skills?: string;
  maxSteps?: number;
  maxTokens?: number;
  compactions?: number;
  sessionId?: number;
  auto?: boolean;
  plan?: boolean;
  event?: string;
  tool?: string;
  command?: string;
  tasksJson?: string;
  crewMode?: string;
  preset?: string;
  inputsJson?: string;
  budget?: number;
  name?: string;
  description?: string;
  instructions?: string;
  bundle?: string;
  timeoutMs?: number;
  dryRun: boolean;
}

export function agentHelp(): string {
  return [
    'Agent runs (dashboard authentication):',
    '  omnipix agent run --goal "..." [--model ID] [--tools a,b] [--skills a,b] [--max-steps N] [--max-tokens N] [--compactions N] [--session ID] [--plan]',
    '  omnipix agent list',
    '  omnipix agent show <id>',
    '  omnipix agent search <words...>',
    '  omnipix agent stop <id>',
    '  omnipix agent checkpoints <run-id>',
    '  omnipix agent snapshot <run-id>',
    '  omnipix agent restore <checkpoint-id>',
    '  omnipix agent approve <approval-id>',
    '  omnipix agent deny <approval-id>',
    '  omnipix agent sessions',
    '  omnipix agent session <id>',
    '  omnipix agent session-delete <id>',
    '  omnipix agent group-create --goal "..." [--auto] [--tasks JSON] [--preset NAME] [--inputs JSON] [--budget N] [--mode dag|hierarchical]',
    '  omnipix agent runbooks',
    '  omnipix agent groups',
    '  omnipix agent group <id>',
    '  omnipix agent group-stop <id>',
    '  omnipix agent group-delete <id>',
    '',
    'Options: --url URL, --token TOKEN, --timeout MS (default 30000), --model ID (default auto)',
    'run follows the run to completion and exits 1 when the run errors or is',
    'stopped; a run parked for approval exits 2 so scripts can tell the states apart.',
    '--plan drafts a plan first and parks it for approval before any tool runs.',
  ].join('\n');
}

export function skillsHelp(): string {
  return [
    'Agent skills (dashboard authentication):',
    '  omnipix skills list',
    '  omnipix skills create --name N --description D --instructions I [--bundle a,b]',
    '  omnipix skills enable <name>',
    '  omnipix skills disable <name>',
    '  omnipix skills delete <name>',
    '  omnipix skills export <name>      (prints SKILL.md to stdout)',
    '  omnipix skills import <file>',
    '  omnipix skills proposals',
    '  omnipix skills accept <id>',
    '  omnipix skills discard <id>',
    '',
    'Options: --url URL, --token TOKEN, --timeout MS (default 30000)',
    'Built-in skills can be disabled but not deleted.',
  ].join('\n');
}

export function hooksHelp(): string {
  return [
    'Agent lifecycle hooks (dashboard authentication):',
    '  omnipix hooks list',
    '  omnipix hooks create --name N --event pre|post --command C [--tool T]',
    '  omnipix hooks enable <id>',
    '  omnipix hooks disable <id>',
    '  omnipix hooks delete <id>',
    '',
    'Options: --url URL, --token TOKEN, --timeout MS (default 30000)',
    'Pre hooks veto tool calls (nonzero exit denies, before approval); post',
    'hooks observe settled calls. New hooks get the default 30s timeout;',
    'tune it in the dashboard.',
  ].join('\n');
}

interface AgentStep {
  seq: number;
  kind: string;
  label: string;
  content: Record<string, unknown> | null;
}

interface AgentRun {
  id: number;
  goal: string;
  model: string;
  tools: string[];
  skills: string[];
  session_id: number | null;
  status: 'running' | 'done' | 'error' | 'stopped' | 'awaiting_approval';
  final_answer: string | null;
  error: string | null;
  steps_used: number;
  prompt_tokens: number;
  completion_tokens: number;
  plan_mode: number;
  parent_run_id: number | null;
  auto_approve: number;
  steps: AgentStep[];
}

interface AgentSession {
  id: number;
  title: string;
  run_count: number;
  last_status: string | null;
}

interface CheckpointRow {
  id: number;
  run_id: number;
  seq: number;
  label: string;
  created_at: string;
}

interface ApprovalRow {
  id: number;
  run_id: number;
  tool: string;
  summary: string;
  status: string;
}

interface SkillRow {
  name: string;
  description: string;
  enabled: number;
  builtin: number;
}

interface HookRow {
  id: number;
  name: string;
  event: string;
  tool_filter: string;
  command: string;
  timeout_ms: number;
  enabled: number;
}

function gatewayRoot(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('--url must be an HTTP(S) gateway URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('--url must be an HTTP(S) URL without credentials, a query, or a fragment');
  }
  return url.href.replace(/\/+$/, '').replace(/\/v1$/i, '');
}

function setup(options: AgentCommandOptions): { request: <T>(path: string, method?: string, body?: unknown) => Promise<T> } {
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
      // Server error bodies are small JSON here; surface the message only.
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

function csv(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  return value.split(',').map(part => part.trim()).filter(Boolean);
}

function stepLine(step: AgentStep): string {
  const content = step.content ?? {};
  switch (step.kind) {
    case 'thought':
    case 'answer':
    case 'plan':
      return typeof content.text === 'string' ? content.text : '';
    case 'tool_call':
      return `${String(content.tool ?? '?')}(${typeof content.args === 'string' ? content.args : JSON.stringify(content.args ?? {})})`;
    case 'tool_result':
      return String(content.result ?? (content.ok === false ? content.error ?? 'failed' : ''));
    case 'restore':
      return `restored checkpoint #${String(content.checkpoint_id ?? '?')} (${String(content.label ?? '')})`;
    case 'hook':
      return `hook "${String(content.hook ?? '?')}" (${String(content.event ?? '')}): ${String(content.message ?? '')}`;
    case 'compact':
      return `context compacted (cycle ${String(content.cycle ?? '?')}${typeof content.trigger === 'string' ? `, ${content.trigger}` : ''}): ${typeof content.summary === 'string' ? content.summary : ''}`;
    default:
      return JSON.stringify(content);
  }
}

function printRun(run: AgentRun, fromSeq: number, write: (line: string) => void): number {
  let seen = fromSeq;
  for (const step of run.steps.filter(step => step.seq > fromSeq)) {
    write(`[#${step.seq} ${step.label}] ${stepLine(step)}`);
    seen = Math.max(seen, step.seq);
  }
  return seen;
}

export async function runAgent(
  options: AgentCommandOptions,
  write: (line: string) => void = line => process.stdout.write(`${line}\n`),
  sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
): Promise<number> {
  const [action, idArg, ...extra] = options.args;
  if (!action || !['run', 'list', 'show', 'search', 'stop', 'approve', 'deny', 'sessions', 'session', 'session-delete', 'group-create', 'runbooks', 'groups', 'group', 'group-stop', 'group-delete', 'checkpoints', 'snapshot', 'restore'].includes(action)) {
    throw new Error(`Expected agent run, list, show, search, stop, approve, deny, sessions, session, session-delete, group-create, runbooks, groups, group, group-stop, group-delete, checkpoints, snapshot, or restore.\n\n${agentHelp()}`);
  }
  if (options.dryRun) throw new Error('--dry-run is not supported by agent; no request was made');
  const { request } = setup(options);

  if (action === 'run') {
    if (idArg !== undefined || extra.length) throw new Error(`Invalid arguments for agent run.\n\n${agentHelp()}`);
    const goal = options.goal?.trim();
    if (!goal) throw new Error('agent run needs --goal "..."');
    const created = await request<AgentRun>('/api/agents/runs', 'POST', {
      goal,
      model: options.model ?? 'auto',
      tools: csv(options.tools),
      skills: csv(options.skills),
      maxSteps: options.maxSteps,
      maxTokens: options.maxTokens,
      sessionId: options.sessionId,
      planMode: options.plan ?? false,
      compactions: options.compactions,
    });
    write(`run ${created.id} (${created.status})`);
    let seen = printRun(created, 0, write);
    // Poll rather than SSE: the CLI has no EventSource and the run replays
    // persisted steps, so polling converges on the same transcript.
    for (let polls = 0; polls < 600; polls += 1) {
      const run = await request<AgentRun>(`/api/agents/runs/${created.id}`);
      seen = printRun(run, seen, write);
      if (run.status === 'awaiting_approval') {
        const { approvals } = await request<{ approvals: ApprovalRow[] }>('/api/agents/approvals?status=pending&limit=100');
        const mine = approvals.filter(a => a.run_id === run.id);
        for (const approval of mine) {
          write(`approval #${approval.id}: ${approval.summary} [${approval.tool}]`);
        }
        write(`run ${run.id} is waiting for approval — decide with: omnipix agent approve|deny <approval-id>`);
        return 2;
      }
      if (run.status !== 'running') {
        if (run.final_answer) write(`\n${run.final_answer}`);
        if (run.error) write(`error: ${run.error}`);
        write(`[${run.status}] ${run.steps_used} steps, ${run.prompt_tokens + run.completion_tokens} tokens`);
        return run.status === 'done' ? 0 : 1;
      }
      await sleep(1000);
    }
    throw new Error(`run ${created.id} did not finish after 10 minutes of polling`);
  }

  if (action === 'group-create') {
    if (idArg !== undefined || extra.length) throw new Error(`Invalid arguments for agent group-create.\n\n${agentHelp()}`);
    const goal = options.goal?.trim();
    if (!goal) throw new Error('agent group-create needs --goal "..."');
    let tasks: unknown;
    if (options.tasksJson !== undefined) {
      try {
        tasks = JSON.parse(options.tasksJson);
      } catch {
        throw new Error('--tasks must be a JSON array of task objects');
      }
      if (!Array.isArray(tasks)) throw new Error('--tasks must be a JSON array of task objects');
    }
    const mode = options.crewMode?.trim().toLowerCase();
    if (mode !== undefined && mode !== 'dag' && mode !== 'hierarchical') {
      throw new Error(`--mode must be dag or hierarchical, got '${options.crewMode}'`);
    }
    const preset = options.preset?.trim();
    let inputs: unknown;
    if (options.inputsJson !== undefined) {
      try {
        inputs = JSON.parse(options.inputsJson);
      } catch {
        throw new Error('--inputs must be a JSON object of string values');
      }
      if (typeof inputs !== 'object' || inputs === null || Array.isArray(inputs)) {
        throw new Error('--inputs must be a JSON object of string values');
      }
    }
    const sources = [tasks !== undefined, !!options.auto, !!preset].filter(Boolean).length;
    if (sources > 1) throw new Error('agent group-create takes only one of --auto, --tasks, or --preset');
    if (tasks === undefined && !options.auto && !preset && mode !== 'hierarchical') {
      throw new Error('agent group-create needs --auto, --tasks JSON, or --preset NAME');
    }
    const group = await request<{ id: number; tasks: Array<{ id: number; name: string }> }>('/api/agents/groups', 'POST', {
      goal,
      ...(tasks !== undefined ? { tasks } : options.auto ? { auto: true } : preset ? { preset } : {}),
      ...(inputs === undefined ? {} : { inputs }),
      ...(mode === 'hierarchical' ? { mode: 'hierarchical' } : {}),
      budgetTokens: options.budget,
    });
    write(`group ${group.id} (${group.tasks.length} tasks)`);
    for (const task of group.tasks) write(`  ${task.id}\t${task.name}`);
    return 0;
  }

  if (action === 'runbooks') {
    if (idArg !== undefined || extra.length) throw new Error(`Invalid arguments for agent runbooks.\n\n${agentHelp()}`);
    const { runbooks } = await request<{ runbooks: Array<{ name: string; description: string; tasks: Array<{ name: string }> }> }>('/api/agents/runbooks');
    for (const runbook of runbooks) {
      write(`${runbook.name}\t${runbook.tasks.map(t => t.name).join(' -> ')}\t${runbook.description}`);
    }
    return 0;
  }

  if (action === 'groups') {
    if (idArg !== undefined || extra.length) throw new Error(`Invalid arguments for agent groups.\n\n${agentHelp()}`);
    const { groups } = await request<{ groups: Array<{ id: number; goal: string; status: string; done_count: number; task_count: number }> }>('/api/agents/groups?limit=30');
    for (const group of groups) {
      write(`${group.id}\t${group.status}\t${group.done_count}/${group.task_count}\t${group.goal}`);
    }
    return 0;
  }

  if (action === 'group' || action === 'group-stop' || action === 'group-delete') {
    const groupId = Number(idArg);
    if (!idArg || !Number.isSafeInteger(groupId) || groupId <= 0 || extra.length) {
      throw new Error(`agent ${action} needs a positive group id.\n\n${agentHelp()}`);
    }
    if (action === 'group-stop') {
      const group = await request<{ id: number; status: string }>(`/api/agents/groups/${groupId}/stop`, 'POST');
      write(`group ${group.id}: ${group.status}`);
      return 0;
    }
    if (action === 'group-delete') {
      await request(`/api/agents/groups/${groupId}`, 'DELETE');
      write(`deleted group ${groupId}`);
      return 0;
    }
    const group = await request<{
      id: number; goal: string; status: string; tokens_used: number;
      mode?: string; manager_decisions?: number;
      workspace?: string; git_branch?: string | null;
      tasks: Array<{
        id: number; name: string; role: string; status: string; error: string | null;
        expected_output: string | null;
        inputs: Array<{ name: string; from: number }>;
        handoff: { summary: string; outputs: Record<string, unknown> } | null;
        verdict: { pass: boolean; reason: string; kind: string } | null;
        output_json: number;
        output_file: string | null;
      }>;
      blackboard: Array<{ key: string; value: unknown }>;
    }>(`/api/agents/groups/${groupId}`);
    write(`group ${group.id} (${group.status}): ${group.goal} [${group.tokens_used} tokens]`);
    if (group.mode === 'hierarchical') write(`mode: hierarchical (${group.manager_decisions ?? 0} manager decisions)`);
    if (group.workspace) write(`workspace: ${group.workspace}${group.git_branch ? ` @ ${group.git_branch}` : ''}`);
    const taskName = (id: number): string => group.tasks.find(t => t.id === id)?.name ?? `#${id}`;
    for (const task of group.tasks) {
      write(`  ${task.id}\t${task.status}\t${task.name} (${task.role})${task.error ? `\t${task.error}` : ''}`);
      if (task.expected_output) write(`    expects: ${task.expected_output.slice(0, 160)}`);
      for (const wire of task.inputs ?? []) {
        write(`    <- ${wire.name} from ${taskName(wire.from)}`);
      }
      const keys = Object.keys(task.handoff?.outputs ?? {});
      if (keys.length) write(`    handoff: ${keys.join(', ').slice(0, 160)}`);
      if (task.verdict) write(`    verdict: ${task.verdict.pass ? 'PASS' : 'FAIL'} — ${task.verdict.reason.slice(0, 160)}`);
      if (task.output_json === 1 || task.output_file) {
        const target = [task.output_json === 1 ? 'JSON' : null, task.output_file ?? null].filter(Boolean).join(' -> ');
        write(`    output: ${target}`);
      }
    }
    for (const entry of group.blackboard) {
      write(`  board ${entry.key}: ${JSON.stringify(entry.value).slice(0, 200)}`);
    }
    return 0;
  }

  if (action === 'sessions') {
    if (idArg !== undefined || extra.length) throw new Error(`Invalid arguments for agent sessions.\n\n${agentHelp()}`);
    const { sessions } = await request<{ sessions: AgentSession[] }>('/api/agents/sessions?limit=30');
    for (const session of sessions) {
      write(`${session.id}\t${session.title || '(untitled)'}\t${session.run_count} runs\t${session.last_status ?? '-'}`);
    }
    return 0;
  }

  if (action === 'approve' || action === 'deny') {
    const approvalId = Number(idArg);
    if (!idArg || !Number.isSafeInteger(approvalId) || approvalId <= 0 || extra.length) {
      throw new Error(`agent ${action} needs a positive approval id.\n\n${agentHelp()}`);
    }
    const { approval } = await request<{ approval: ApprovalRow }>(
      `/api/agents/approvals/${approvalId}/decide`, 'POST', { approved: action === 'approve' },
    );
    write(`approval ${approval.id}: ${approval.status}`);
    return 0;
  }

  if (action === 'list') {
    if (idArg !== undefined || extra.length) throw new Error(`Invalid arguments for agent list.\n\n${agentHelp()}`);
    const { runs } = await request<{ runs: AgentRun[] }>('/api/agents/runs?limit=30');
    for (const run of runs) {
      write(`${run.id}\t${run.status}\t${run.steps_used} steps\t${run.goal}`);
    }
    return 0;
  }

  if (action === 'session' || action === 'session-delete') {
    const sessionId = Number(idArg);
    if (!idArg || !Number.isSafeInteger(sessionId) || sessionId <= 0 || extra.length) {
      throw new Error(`agent ${action} needs a positive session id.\n\n${agentHelp()}`);
    }
    if (action === 'session-delete') {
      await request(`/api/agents/sessions/${sessionId}`, 'DELETE');
      write(`deleted session ${sessionId}`);
      return 0;
    }
    const session = await request<AgentSession & { runs: AgentRun[] }>(`/api/agents/sessions/${sessionId}`);
    write(`session ${session.id}: ${session.title || '(untitled)'} (${session.run_count} runs)`);
    for (const run of session.runs) {
      write(`  ${run.id}\t${run.status}\t${run.goal}`);
    }
    return 0;
  }

  if (action === 'search') {
    const query = [idArg, ...extra].filter(Boolean).join(' ').trim();
    if (!query) throw new Error(`agent search needs search words.\n\n${agentHelp()}`);
    const { runs } = await request<{ runs: Array<{ id: number; goal: string; status: string }> }>(
      `/api/agents/runs/search?q=${encodeURIComponent(query)}&limit=30`,
    );
    for (const run of runs) {
      write(`${run.id}\t${run.status}\t${run.goal}`);
    }
    return 0;
  }

  if (action === 'checkpoints' || action === 'snapshot' || action === 'restore') {
    const target = Number(idArg);
    const what = action === 'restore' ? 'checkpoint id' : 'run id';
    if (!idArg || !Number.isSafeInteger(target) || target <= 0 || extra.length) {
      throw new Error(`agent ${action} needs a positive ${what}.\n\n${agentHelp()}`);
    }
    if (action === 'checkpoints') {
      const { checkpoints } = await request<{ checkpoints: CheckpointRow[] }>(`/api/agents/runs/${target}/checkpoints`);
      for (const cp of checkpoints) {
        write(`${cp.id}\tstep ${cp.seq}\t${cp.created_at}\t${cp.label || '(auto)'}`);
      }
      return 0;
    }
    if (action === 'snapshot') {
      const { checkpoint } = await request<{ checkpoint: CheckpointRow }>(`/api/agents/runs/${target}/checkpoints`, 'POST', {});
      write(`checkpoint ${checkpoint.id} for run ${target}${checkpoint.label ? `: ${checkpoint.label}` : ''}`);
      return 0;
    }
    const { restored, run } = await request<{ restored: number; run: AgentRun }>(`/api/agents/checkpoints/${target}/restore`, 'POST');
    write(`restored checkpoint ${restored}; run ${run.id} is ${run.status}`);
    return 0;
  }

  const id = Number(idArg);
  if (!idArg || !Number.isSafeInteger(id) || id <= 0 || extra.length) {
    throw new Error(`agent ${action} needs a positive run id.\n\n${agentHelp()}`);
  }
  if (action === 'stop') {
    const run = await request<AgentRun>(`/api/agents/runs/${id}/stop`, 'POST');
    write(`run ${run.id}: ${run.status}`);
    return 0;
  }
  const run = await request<AgentRun>(`/api/agents/runs/${id}`);
  write(`run ${run.id} (${run.status}): ${run.goal}${run.plan_mode === 1 ? ' [plan mode]' : ''}${run.parent_run_id != null ? ` [child of ${run.parent_run_id}]` : ''}${run.auto_approve === 1 ? ' [auto-approved]' : ''}`);
  printRun(run, 0, write);
  if (run.final_answer) write(`\n${run.final_answer}`);
  if (run.error) write(`error: ${run.error}`);
  return 0;
}

export async function runSkills(
  options: AgentCommandOptions,
  write: (line: string) => void = line => process.stdout.write(`${line}\n`),
): Promise<number> {
  const [action, nameArg, ...extra] = options.args;
  if (!action || !['list', 'create', 'enable', 'disable', 'delete', 'export', 'import', 'proposals', 'accept', 'discard'].includes(action)) {
    throw new Error(`Expected skills list, create, enable, disable, delete, export, import, proposals, accept, or discard.\n\n${skillsHelp()}`);
  }
  if (options.dryRun) throw new Error('--dry-run is not supported by skills; no request was made');
  const { request } = setup(options);

  if (action === 'export') {
    if (!nameArg || extra.length) throw new Error(`skills export needs a skill name.\n\n${skillsHelp()}`);
    const { content } = await request<{ name: string; content: string }>(
      `/api/skills/${encodeURIComponent(nameArg)}/export`,
    );
    write(content.trimEnd());
    return 0;
  }

  if (action === 'import') {
    if (!nameArg || extra.length) throw new Error(`skills import needs a file path.\n\n${skillsHelp()}`);
    let content: string;
    try {
      content = readFileSync(nameArg, 'utf8');
    } catch {
      throw new Error(`Cannot read skill file: ${nameArg}`);
    }
    if (!content.trim()) throw new Error(`Skill file is empty: ${nameArg}`);
    const { skill } = await request<{ skill: SkillRow }>('/api/skills/import', 'POST', { content });
    write(`imported ${skill.name}`);
    return 0;
  }

  if (action === 'list') {
    if (nameArg !== undefined || extra.length) throw new Error(`Invalid arguments for skills list.\n\n${skillsHelp()}`);
    const { skills } = await request<{ skills: SkillRow[] }>('/api/skills');
    for (const skill of skills) {
      write(`${skill.name}\t${skill.enabled ? 'enabled' : 'disabled'}\t${skill.builtin ? 'built-in' : 'custom'}\t${skill.description}`);
    }
    return 0;
  }

  if (action === 'create') {
    if (nameArg !== undefined || extra.length) throw new Error(`Invalid arguments for skills create.\n\n${skillsHelp()}`);
    const name = options.name?.trim();
    const description = options.description?.trim();
    const instructions = options.instructions?.trim();
    if (!name || !description || !instructions) {
      throw new Error('skills create needs --name, --description, and --instructions');
    }
    const bundle = options.bundle ? options.bundle.split(',').map(s => s.trim()).filter(Boolean) : [];
    const { skill } = await request<{ skill: SkillRow }>('/api/skills', 'POST', { name, description, instructions, bundle });
    write(`created ${skill.name}`);
    return 0;
  }

  if (action === 'proposals') {
    if (nameArg !== undefined || extra.length) throw new Error(`Invalid arguments for skills proposals.\n\n${skillsHelp()}`);
    const { proposals } = await request<{ proposals: Array<{ id: number; kind: string; title: string; source_run_id: number | null }> }>('/api/agents/proposals');
    for (const proposal of proposals) {
      write(`${proposal.id}\t${proposal.kind}\t${proposal.title}${proposal.source_run_id != null ? `\trun #${proposal.source_run_id}` : ''}`);
    }
    return 0;
  }

  if (action === 'accept' || action === 'discard') {
    const id = Number(nameArg);
    if (!nameArg || !Number.isSafeInteger(id) || id <= 0 || extra.length) {
      throw new Error(`skills ${action} needs a positive proposal id.\n\n${skillsHelp()}`);
    }
    const { proposal } = await request<{ proposal: { id: number; title: string; status: string } }>(
      `/api/agents/proposals/${id}/${action}`, 'POST',
    );
    write(`proposal ${proposal.id} (${proposal.title}): ${proposal.status}`);
    return 0;
  }

  if (!nameArg || extra.length) throw new Error(`skills ${action} needs a skill name.\n\n${skillsHelp()}`);
  if (action === 'delete') {
    await request(`/api/skills/${encodeURIComponent(nameArg)}`, 'DELETE');
    write(`deleted ${nameArg}`);
    return 0;
  }
  const { skill } = await request<{ skill: SkillRow }>(
    `/api/skills/${encodeURIComponent(nameArg)}`,
    'PATCH',
    { enabled: action === 'enable' },
  );
  write(`${skill.name}: ${skill.enabled ? 'enabled' : 'disabled'}`);
  return 0;
}

export async function runHooks(
  options: AgentCommandOptions,
  write: (line: string) => void = line => process.stdout.write(`${line}\n`),
): Promise<number> {
  const [action, idArg, ...extra] = options.args;
  if (!action || !['list', 'create', 'enable', 'disable', 'delete'].includes(action)) {
    throw new Error(`Expected hooks list, create, enable, disable, or delete.\n\n${hooksHelp()}`);
  }
  if (options.dryRun) throw new Error('--dry-run is not supported by hooks; no request was made');
  const { request } = setup(options);

  if (action === 'list') {
    if (idArg !== undefined || extra.length) throw new Error(`Invalid arguments for hooks list.\n\n${hooksHelp()}`);
    const { hooks } = await request<{ hooks: HookRow[] }>('/api/agents/hooks');
    for (const hook of hooks) {
      write(`${hook.id}\t${hook.enabled ? 'enabled' : 'disabled'}\t${hook.event}\t${hook.tool_filter || '(any)'}\t${hook.name}\t${hook.command}`);
    }
    return 0;
  }

  if (action === 'create') {
    if (idArg !== undefined || extra.length) throw new Error(`Invalid arguments for hooks create.\n\n${hooksHelp()}`);
    const name = options.name?.trim();
    const command = options.command?.trim();
    const event = options.event?.trim().toLowerCase();
    if (!name || !command || (event !== 'pre' && event !== 'post')) {
      throw new Error('hooks create needs --name, --event pre|post, and --command');
    }
    const { hook } = await request<{ hook: HookRow }>('/api/agents/hooks', 'POST', {
      name,
      event: event === 'pre' ? 'pre_tool' : 'post_tool',
      toolFilter: options.tool?.trim() || '',
      command,
    });
    write(`created hook ${hook.id} (${hook.name})`);
    return 0;
  }

  const id = Number(idArg);
  if (!idArg || !Number.isSafeInteger(id) || id <= 0 || extra.length) {
    throw new Error(`hooks ${action} needs a positive hook id.\n\n${hooksHelp()}`);
  }
  if (action === 'delete') {
    await request(`/api/agents/hooks/${id}`, 'DELETE');
    write(`deleted hook ${id}`);
    return 0;
  }
  const { hook } = await request<{ hook: HookRow }>(
    `/api/agents/hooks/${id}`,
    'PATCH',
    { enabled: action === 'enable' },
  );
  write(`hook ${hook.id} (${hook.name}): ${hook.enabled ? 'enabled' : 'disabled'}`);
  return 0;
}
