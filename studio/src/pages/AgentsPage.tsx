import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Brain, Check, Play, Plus, Square, Trash2, Users } from 'lucide-react';
import { StatusDot } from '../components/StatusDot';
import { EmptyState } from '../components/EmptyState';
import { ApprovalPrompt } from '../components/ApprovalPrompt';
import { useStudio } from '../state/store';
import { apiFetch } from '../lib/api';
import { useApprovals, useAutomations, useGroups, useMemories, useRunbooks, useRuns, type AgentRun } from '../lib/queries';

const TABS = ['Runs', 'Teams', 'Approvals', 'Hooks', 'Automations', 'Assistant'] as const;

export function AgentsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Runs');
  return (
    <div className="mx-auto max-w-5xl px-5 py-4">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-lg font-semibold">Agents</h1>
      </div>
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line" role="tablist" aria-label="Agents sections">
        {TABS.map(t => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`shrink-0 border-b-2 px-3 py-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              tab === t ? 'border-accent font-medium' : 'border-transparent text-ink-dim hover:text-ink'
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === 'Runs' && <RunsTab />}
      {tab === 'Teams' && <TeamsTab />}
      {tab === 'Approvals' && <ApprovalsTab />}
      {tab === 'Hooks' && <HooksTab />}
      {tab === 'Automations' && <AutomationsTab />}
      {tab === 'Assistant' && <AssistantTab />}
    </div>
  );
}

function RunsTab() {
  const { data } = useRuns();
  const { setActiveRunId, setRail, activeRunId, pushToast } = useStudio();
  const queryClient = useQueryClient();
  const runs = data?.runs ?? [];
  if (!runs.length) {
    return <EmptyState icon={<Play className="size-5" strokeWidth={1.5} />} title="No agent runs yet" body="Send a message in Agent mode and the run lands here with its full step trace." />;
  }
  async function stop(id: number) {
    try {
      await apiFetch(`/api/agents/runs/${id}/stop`, { method: 'POST' });
      pushToast('ok', `Run #${id} stopped`);
      void queryClient.invalidateQueries({ queryKey: ['agent-runs'] });
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Stop failed');
    }
  }
  return (
    <div className="space-y-2">
      {runs.map(run => <RunCard key={run.id} run={run} active={run.id === activeRunId} onOpen={() => { setActiveRunId(run.id); setRail('chat'); }} onStop={() => void stop(run.id)} />)}
    </div>
  );
}

function runStatus(run: AgentRun): 'running' | 'done' | 'failed' | 'idle' | 'waiting' {
  if (run.status === 'running') return 'running';
  if (run.status === 'awaiting_approval') return 'waiting';
  if (run.status === 'done') return 'done';
  if (run.status === 'error') return 'failed';
  return 'idle';
}

function RunCard({ run, active, onOpen, onStop }: { run: AgentRun; active: boolean; onOpen: () => void; onStop: () => void }) {
  return (
    <article className={`rounded-xl border bg-base-1 p-4 ${active ? 'border-accent/60' : 'border-line'}`}>
      <div className="flex items-center gap-2">
        <StatusDot status={runStatus(run)} pulse />
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 truncate text-left text-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent">
          #{run.id} · {run.goal}
        </button>
        <span className="shrink-0 font-mono text-[11px] text-ink-dim">
          {run.steps_used} steps · ${(run.cost_usd ?? 0).toFixed(2)}
        </span>
        {(run.status === 'running' || run.status === 'awaiting_approval') && (
          <button
            type="button"
            onClick={onStop}
            className="flex shrink-0 items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Square className="size-3" strokeWidth={1.5} /> Stop
          </button>
        )}
      </div>
      {run.error && <p className="mt-1.5 truncate font-mono text-[11px] text-bad">{run.error}</p>}
      {run.final_answer && <p className="mt-1.5 line-clamp-2 text-xs text-ink-dim">{run.final_answer}</p>}
    </article>
  );
}

function TeamsTab() {
  const { data } = useGroups();
  const { data: runbooksData } = useRunbooks();
  const { pushToast } = useStudio();
  const queryClient = useQueryClient();
  const [goal, setGoal] = useState('');
  const [preset, setPreset] = useState('');
  const [busy, setBusy] = useState(false);
  const groups = data?.groups ?? [];
  const runbooks = runbooksData?.runbooks ?? [];

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!goal.trim()) {
      pushToast('error', 'Describe the goal first');
      return;
    }
    setBusy(true);
    try {
      const body: Record<string, unknown> = { goal: goal.trim() };
      if (preset) body.preset = preset;
      else body.auto = true;
      await apiFetch('/api/agents/groups', { method: 'POST', body: JSON.stringify(body) });
      pushToast('ok', preset ? `Team started from ${preset}` : 'Team started — the planner is building its tasks');
      setGoal('');
      void queryClient.invalidateQueries({ queryKey: ['agent-groups'] });
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  const form = (
    <form onSubmit={e => void create(e)} className="mb-3 rounded-xl border border-line bg-base-1 p-4">
      <p className="mb-2 text-[13px] font-medium">Start a team</p>
      <div className="flex flex-col gap-1.5 sm:flex-row">
        <input
          value={goal}
          onChange={e => setGoal(e.target.value)}
          placeholder="Goal: ship user auth with tests…"
          className="min-w-0 flex-1 rounded-lg border border-line bg-base-0 px-2.5 py-2 text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent"
        />
        <select
          value={preset}
          onChange={e => setPreset(e.target.value)}
          aria-label="Team template"
          className="rounded-lg border border-line bg-base-0 px-2 py-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <option value="">Auto-plan tasks</option>
          {runbooks.map(r => (
            <option key={r.name} value={r.name} title={r.description}>{r.name} — {r.description}</option>
          ))}
        </select>
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
        >
          {busy ? 'Starting…' : 'Start team'}
        </button>
      </div>
    </form>
  );

  if (!groups.length) {
    return (
      <div>
        {form}
        <EmptyState icon={<Users className="size-5" strokeWidth={1.5} />} title="No teams yet" body="Multi-agent crews with a shared workspace appear here." />
      </div>
    );
  }
  async function act(id: number, action: 'stop' | 'resume') {
    try {
      await apiFetch(`/api/agents/groups/${id}/${action}`, { method: 'POST' });
      pushToast('ok', `Group #${id} ${action === 'stop' ? 'stopped' : 'resumed'}`);
      void queryClient.invalidateQueries({ queryKey: ['agent-groups'] });
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : `${action} failed`);
    }
  }
  return (
    <div className="space-y-2">
      {form}
      {groups.map(g => (
        <article key={g.id} className="rounded-xl border border-line bg-base-1 p-4">
          <div className="flex items-center gap-2">
            <Users className="size-4 shrink-0 text-ink-dim" strokeWidth={1.5} />
            <p className="min-w-0 flex-1 truncate text-sm font-medium">#{g.id} · {g.goal}</p>
            <span className="shrink-0 font-mono text-[11px] text-ink-dim">{g.done_count}/{g.task_count} · {g.status}</span>
          </div>
          <div className="mt-2.5 flex gap-1.5">
            {(g.status === 'running' || g.status === 'awaiting_approval') && (
              <button type="button" onClick={() => void act(g.id, 'stop')} className="rounded-lg border border-line px-2.5 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent">Stop</button>
            )}
            {(g.status === 'stopped' || g.status === 'error') && (
              <button type="button" onClick={() => void act(g.id, 'resume')} className="rounded-lg border border-line px-2.5 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent">Resume</button>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

function ApprovalsTab() {
  const { data } = useApprovals();
  const pending = (data?.approvals ?? []).filter(a => a.status === 'pending');
  if (!pending.length) {
    return <EmptyState icon={<Check className="size-5" strokeWidth={1.5} />} title="Inbox zero" body="Parked tool calls land here for a human decision." />;
  }
  return (
    <div className="space-y-3">
      {pending.map(a => (
        <ApprovalPrompt
          key={a.id}
          tool={a.tool}
          approval={{
            id: String(a.id),
            kind: a.tool === 'shell_exec' ? 'command' : a.tool.includes('delete') ? 'delete' : 'network',
            command: a.summary || a.tool,
            cwd: `run #${a.run_id}`,
            risk: (a.risk as 'low' | 'medium' | 'high') ?? 'medium',
          }}
        />
      ))}
    </div>
  );
}

interface HookRow {
  id: number;
  name: string;
  event: string;
  tool_filter: string;
  command: string;
  enabled: number;
}

function HooksTab() {
  const { pushToast } = useStudio();
  const [hooks, setHooks] = useState<HookRow[] | null>(null);
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [event, setEvent] = useState('pre-tool');

  async function refresh() {
    try {
      const res = await apiFetch<{ hooks: HookRow[] }>('/api/agents/hooks');
      setHooks(res.hooks);
    } catch {
      setHooks([]);
    }
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggle(hook: HookRow) {
    try {
      await apiFetch(`/api/agents/hooks/${hook.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !hook.enabled }) });
      void refresh();
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Toggle failed');
    }
  }

  async function create() {
    if (!name.trim() || !command.trim()) {
      pushToast('error', 'Name and command are required');
      return;
    }
    try {
      await apiFetch('/api/agents/hooks', { method: 'POST', body: JSON.stringify({ name, event, command }) });
      setName('');
      setCommand('');
      pushToast('ok', 'Hook created');
      void refresh();
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Create failed');
    }
  }

  async function remove(id: number) {
    try {
      await apiFetch(`/api/agents/hooks/${id}`, { method: 'DELETE' });
      void refresh();
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Delete failed');
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5 rounded-xl border border-line bg-base-1 p-3">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Hook name" aria-label="Hook name" className="min-w-32 flex-1 rounded-lg border border-line bg-base-0 px-2.5 py-1.5 text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent" />
        <select value={event} onChange={e => setEvent(e.target.value)} aria-label="Hook event" className="rounded-lg border border-line bg-base-1 px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent">
          <option value="pre-tool">pre-tool</option>
          <option value="post-tool">post-tool</option>
          <option value="pre-edit">pre-edit</option>
          <option value="post-edit">post-edit</option>
        </select>
        <input value={command} onChange={e => setCommand(e.target.value)} placeholder="command to run" aria-label="Hook command" className="min-w-40 flex-[2] rounded-lg border border-line bg-base-0 px-2.5 py-1.5 font-mono text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent" />
        <button type="button" onClick={() => void create()} className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent">
          <Plus className="size-3.5" strokeWidth={1.5} /> Add
        </button>
      </div>
      {hooks === null && <p className="animate-pulse text-sm text-ink-dim">Loading hooks…</p>}
      {(hooks ?? []).map(h => (
        <div key={h.id} className="flex items-center gap-3 rounded-xl border border-line bg-base-1 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium">{h.name} <span className="font-mono text-[11px] text-ink-dim">· {h.event}{h.tool_filter ? ` · ${h.tool_filter}` : ''}</span></p>
            <p className="truncate font-mono text-[11px] text-ink-dim">{h.command}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={!!h.enabled}
            aria-label={h.name}
            onClick={() => void toggle(h)}
            className={`relative h-5 w-9 shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent ${h.enabled ? 'bg-accent' : 'bg-base-2'}`}
          >
            <span className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${h.enabled ? 'left-[18px]' : 'left-0.5'}`} />
          </button>
          <button
            type="button"
            aria-label={`Delete ${h.name}`}
            onClick={() => void remove(h.id)}
            className="rounded-md p-1.5 text-ink-faint outline-none hover:text-bad focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Trash2 className="size-3.5" strokeWidth={1.5} />
          </button>
        </div>
      ))}
      {hooks?.length === 0 && <p className="py-4 text-center text-xs text-ink-faint">No hooks — deterministic scripts that run around tool calls.</p>}
    </div>
  );
}

function parseWatchList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

function AutomationsTab() {
  const { data } = useAutomations();
  const { pushToast } = useStudio();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [schedule, setSchedule] = useState('');
  const [watch, setWatch] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const automations = data?.automations ?? [];

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !goal.trim()) {
      pushToast('error', 'Name and goal are required');
      return;
    }
    setBusy(true);
    try {
      const body: Record<string, unknown> = { name: name.trim(), goal: goal.trim() };
      if (schedule.trim()) body.schedule = schedule.trim();
      const watchPaths = watch.split(',').map(s => s.trim()).filter(Boolean);
      if (watchPaths.length) body.watch = watchPaths;
      if (model.trim()) body.model = model.trim();
      await apiFetch('/api/automations', { method: 'POST', body: JSON.stringify(body) });
      pushToast('ok', `Automation '${name.trim()}' created — run it once to review`);
      setName('');
      setGoal('');
      setSchedule('');
      setWatch('');
      setModel('');
      setShowForm(false);
      void queryClient.invalidateQueries({ queryKey: ['automations'] });
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  const form = showForm ? (
    <form onSubmit={e => void create(e)} className="rounded-xl border border-line bg-base-1 p-4">
      <p className="mb-2 text-[13px] font-medium">New automation</p>
      <div className="grid gap-1.5 sm:grid-cols-2">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Name: morning-briefing"
          className="rounded-lg border border-line bg-base-0 px-2.5 py-2 text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent"
        />
        <input
          value={schedule}
          onChange={e => setSchedule(e.target.value)}
          placeholder="Cron (optional): 0 9 * * *"
          spellCheck={false}
          autoComplete="off"
          className="rounded-lg border border-line bg-base-0 px-2.5 py-2 font-mono text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent"
        />
      </div>
      <textarea
        value={goal}
        onChange={e => setGoal(e.target.value)}
        placeholder="Goal: summarize yesterday's commits in ~/work/app…"
        rows={2}
        className="mt-1.5 w-full rounded-lg border border-line bg-base-0 px-2.5 py-2 text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent"
      />
      <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
        <input
          value={watch}
          onChange={e => setWatch(e.target.value)}
          placeholder="Watch paths, comma-separated (optional)"
          spellCheck={false}
          autoComplete="off"
          className="rounded-lg border border-line bg-base-0 px-2.5 py-2 font-mono text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent"
        />
        <input
          value={model}
          onChange={e => setModel(e.target.value)}
          placeholder="Model (optional): auto"
          spellCheck={false}
          autoComplete="off"
          className="rounded-lg border border-line bg-base-0 px-2.5 py-2 font-mono text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent"
        />
      </div>
      <div className="mt-2 flex gap-1.5">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
        >
          {busy ? 'Creating…' : 'Create automation'}
        </button>
        <button
          type="button"
          onClick={() => setShowForm(false)}
          className="rounded-lg border border-line px-3 py-2 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent"
        >
          Cancel
        </button>
      </div>
    </form>
  ) : (
    <button
      type="button"
      onClick={() => setShowForm(true)}
      className="flex items-center gap-1.5 rounded-lg border border-line bg-base-1 px-3 py-2 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent"
    >
      <Plus className="size-3.5" strokeWidth={1.5} /> New automation
    </button>
  );

  if (!automations.length) {
    return (
      <div className="space-y-2">
        {form}
        {!showForm && <EmptyState icon={<Play className="size-5" strokeWidth={1.5} />} title="No automations" body="Scheduled or file-triggered agent goals with a review-first safety gate." />}
      </div>
    );
  }
  async function toggle(id: number, enabled: boolean) {
    try {
      await apiFetch(`/api/automations/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !enabled }) });
      void queryClient.invalidateQueries({ queryKey: ['automations'] });
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Toggle failed');
    }
  }
  async function runNow(id: number) {
    try {
      await apiFetch(`/api/automations/${id}/run`, { method: 'POST' });
      pushToast('ok', 'Manual run started — review it before the schedule fires');
      void queryClient.invalidateQueries({ queryKey: ['automations'] });
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Run failed');
    }
  }
  return (
    <div className="space-y-2">
      {form}
      {automations.map(a => {
        const watching = parseWatchList(a.watch_json);
        return (
        <div key={a.id} className="flex items-center gap-3 rounded-xl border border-line bg-base-1 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium">{a.name}{!a.reviewed && <span className="ml-2 rounded-md bg-warn/15 px-1.5 py-0.5 text-[10px] font-semibold text-warn">NEEDS REVIEW</span>}</p>
            <p className="truncate font-mono text-[11px] text-ink-dim">{a.schedule || 'manual'}{watching.length ? ` · watches ${watching.length} path${watching.length === 1 ? '' : 's'}` : ''} · last: {a.last_status ?? 'never'}</p>
            {!!watching.length && <p className="truncate font-mono text-[11px] text-ink-faint" title={watching.join(', ')}>{watching.join(', ')}</p>}
          </div>
          <button type="button" onClick={() => void runNow(a.id)} className="shrink-0 rounded-lg border border-line px-2.5 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent">Run now</button>
          <button
            type="button"
            role="switch"
            aria-checked={!!a.enabled}
            aria-label={a.name}
            onClick={() => void toggle(a.id, !!a.enabled)}
            className={`relative h-5 w-9 shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent ${a.enabled ? 'bg-accent' : 'bg-base-2'}`}
          >
            <span className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${a.enabled ? 'left-[18px]' : 'left-0.5'}`} />
          </button>
        </div>
        );
      })}
      <p className="text-xs text-ink-dim">Schedules and file watches fire only after one reviewed manual run.</p>
    </div>
  );
}

function AssistantTab() {
  const { data } = useMemories();
  const { pushToast } = useStudio();
  const queryClient = useQueryClient();
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const memories = data?.memories ?? [];

  async function add() {
    if (!key.trim() || !value.trim()) {
      pushToast('error', 'Key and value are required');
      return;
    }
    try {
      await apiFetch('/api/memories', { method: 'POST', body: JSON.stringify({ key, value, scope: 'user' }) });
      setKey('');
      setValue('');
      void queryClient.invalidateQueries({ queryKey: ['memories'] });
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Add failed');
    }
  }

  async function remove(id: number) {
    try {
      await apiFetch(`/api/memories/${id}`, { method: 'DELETE' });
      void queryClient.invalidateQueries({ queryKey: ['memories'] });
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Delete failed');
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5 rounded-xl border border-line bg-base-1 p-3">
        <input value={key} onChange={e => setKey(e.target.value)} placeholder="key" aria-label="Memory key" className="min-w-28 flex-1 rounded-lg border border-line bg-base-0 px-2.5 py-1.5 font-mono text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent" />
        <input value={value} onChange={e => setValue(e.target.value)} placeholder="what the assistant should remember" aria-label="Memory value" className="min-w-40 flex-[2] rounded-lg border border-line bg-base-0 px-2.5 py-1.5 text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent" />
        <button type="button" onClick={() => void add()} className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent">
          <Plus className="size-3.5" strokeWidth={1.5} /> Remember
        </button>
      </div>
      {memories.length === 0 && (
        <EmptyState icon={<Brain className="size-5" strokeWidth={1.5} />} title="No memories" body="Things you teach the assistant live here, scoped per user and project." />
      )}
      {memories.map(m => (
        <div key={m.id} className="flex items-center gap-3 rounded-xl border border-line bg-base-1 px-4 py-3">
          <Brain className="size-4 shrink-0 text-ink-dim" strokeWidth={1.5} />
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[13px] font-medium">{m.key}</p>
            <p className="truncate text-xs text-ink-dim">{m.value}</p>
          </div>
          <span className="shrink-0 rounded-md bg-base-2 px-1.5 py-0.5 font-mono text-[10px] text-ink-dim">{m.scope}</span>
          <button
            type="button"
            aria-label={`Forget ${m.key}`}
            onClick={() => void remove(m.id)}
            className="rounded-md p-1.5 text-ink-faint outline-none hover:text-bad focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Trash2 className="size-3.5" strokeWidth={1.5} />
          </button>
        </div>
      ))}
    </div>
  );
}
