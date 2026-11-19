import { useState } from 'react';
import { Bot, Check, Play, Plus, Square, Users, X } from 'lucide-react';
import { AGENTS, TIMELINE } from '../mock/data';
import { StatusDot } from '../components/StatusDot';
import { EmptyState } from '../components/EmptyState';
import { useStudio } from '../state/store';

const TABS = ['Runs', 'Teams', 'Approvals', 'Hooks', 'Automations', 'Assistant'] as const;

export function AgentsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Runs');
  const { setAgentEditor } = useStudio();
  return (
    <div className="mx-auto max-w-5xl px-5 py-4">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-lg font-semibold">Agents</h1>
        <span className="flex-1" />
        <button type="button" onClick={() => setAgentEditor('new')} className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent">
          <Plus className="size-3.5" strokeWidth={1.5} /> New agent
        </button>
      </div>
      <div className="mb-4 flex gap-1 border-b border-line" role="tablist" aria-label="Agents sections">
        {TABS.map(t => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`border-b-2 px-3 py-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-accent ${
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
  const { pushToast, setAgentEditor } = useStudio();
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {AGENTS.map(agent => (
        <article key={agent.id} className="rounded-xl border border-line bg-base-1 p-4">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-base-2">
              <Bot className="size-4 text-ink-dim" strokeWidth={1.5} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{agent.name}</p>
              <p className="font-mono text-[11px] text-ink-dim">{agent.model} · {agent.runs} runs</p>
            </div>
            <StatusDot status={agent.status} pulse />
          </div>
          <p className="mt-2 line-clamp-2 text-xs text-ink-dim">{agent.systemPrompt}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {agent.tools.map(t => (
              <span key={t} className="rounded-md bg-base-2 px-1.5 py-0.5 font-mono text-[10px] text-ink-dim">{t}</span>
            ))}
          </div>
          <div className="mt-3 flex gap-1.5">
            <button
              type="button"
              onClick={() => pushToast('info', `Test run started for ${agent.name}`)}
              className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-line px-2 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Play className="size-3.5" strokeWidth={1.5} /> Test run
            </button>
            <button
              type="button"
              onClick={() => setAgentEditor(agent.id)}
              className="flex-1 rounded-lg border border-line px-2 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent"
            >
              Edit
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function TeamsTab() {
  const { pushToast } = useStudio();
  return (
    <div className="space-y-3">
      <article className="rounded-xl border border-line bg-base-1 p-4">
        <div className="flex items-center gap-2">
          <Users className="size-4 text-ink-dim" strokeWidth={1.5} />
          <p className="text-sm font-semibold">Auth crew — 3 tasks, 1 running</p>
          <span className="ml-auto flex items-center gap-1.5 font-mono text-[11px] text-ink-dim"><StatusDot status="running" pulse /> running</span>
        </div>
        <div className="mt-2 space-y-1">
          {TIMELINE.slice(2, 5).map(s => (
            <div key={s.id} className="flex items-center gap-2 rounded-lg bg-base-0 px-2.5 py-1.5 text-xs">
              <StatusDot status={s.status} />
              <span className="min-w-0 flex-1 truncate">{s.title}</span>
              <span className="font-mono text-[10px] text-ink-faint">coder</span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-1.5">
          <button type="button" onClick={() => pushToast('info', 'Group paused')} className="flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent"><Square className="size-3.5" strokeWidth={1.5} /> Pause</button>
          <button type="button" onClick={() => pushToast('ok', 'Group resumed')} className="flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent"><Play className="size-3.5" strokeWidth={1.5} /> Resume</button>
        </div>
      </article>
    </div>
  );
}

function ApprovalsTab() {
  const { approval, decideApproval } = useStudio();
  if (!approval) return <EmptyState icon={<Check className="size-5" strokeWidth={1.5} />} title="Inbox zero" body="Parked tool calls land here for a human decision." />;
  return (
    <article className="rounded-xl border border-warn/50 bg-base-1 p-4">
      <p className="text-sm font-semibold">shell_exec · high risk</p>
      <pre className="mt-2 overflow-x-auto rounded-lg bg-base-0 p-2.5 font-mono text-xs break-all whitespace-pre-wrap">{approval.command}</pre>
      <div className="mt-3 flex gap-1.5">
        <button type="button" onClick={() => decideApproval('once')} className="rounded-lg bg-ok px-3 py-1.5 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent">Allow once</button>
        <button type="button" onClick={() => decideApproval('always')} className="rounded-lg border border-line px-3 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent">Always allow</button>
        <button type="button" onClick={() => decideApproval('deny')} className="flex items-center gap-1 rounded-lg border border-bad/50 px-3 py-1.5 text-xs text-bad outline-none hover:bg-bad/10 focus-visible:ring-2 focus-visible:ring-accent"><X className="size-3.5" strokeWidth={1.5} /> Deny</button>
      </div>
    </article>
  );
}

const HOOKS = [
  { event: 'pre-tool · shell_exec', action: 'Block rm -rf outside workspace', on: true },
  { event: 'post-edit', action: 'Run prettier on changed files', on: true },
  { event: 'pre-commit', action: 'Require tests green', on: false },
];

function HooksTab() {
  const { pushToast } = useStudio();
  return (
    <div className="space-y-2">
      {HOOKS.map(h => (
        <div key={h.event} className="flex items-center gap-3 rounded-xl border border-line bg-base-1 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-xs font-medium">{h.event}</p>
            <p className="truncate text-xs text-ink-dim">{h.action}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={h.on}
            aria-label={h.event}
            onClick={() => pushToast('ok', `Hook ${h.on ? 'disabled' : 'enabled'}`)}
            className={`relative h-5 w-9 shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent ${h.on ? 'bg-accent' : 'bg-base-2'}`}
          >
            <span className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${h.on ? 'left-[18px]' : 'left-0.5'}`} />
          </button>
        </div>
      ))}
    </div>
  );
}

const AUTOMATIONS = [
  { name: 'nightly-eval', schedule: '0 2 * * *', last: 'done · 96%', on: true },
  { name: 'inbox-digest', schedule: '0 8 * * *', last: 'done', on: true },
  { name: 'dep-audit', schedule: '0 9 * * 1', last: 'never run', on: false },
];

function AutomationsTab() {
  const { pushToast } = useStudio();
  return (
    <div className="space-y-2">
      {AUTOMATIONS.map(a => (
        <div key={a.name} className="flex items-center gap-3 rounded-xl border border-line bg-base-1 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium">{a.name}</p>
            <p className="font-mono text-[11px] text-ink-dim">{a.schedule} · {a.last}</p>
          </div>
          <button type="button" onClick={() => pushToast('info', `Manual run of ${a.name}`)} className="rounded-lg border border-line px-2.5 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent">Run now</button>
        </div>
      ))}
      <p className="text-xs text-ink-dim">Schedules fire only after one reviewed manual run.</p>
    </div>
  );
}

function AssistantTab() {
  return (
    <EmptyState
      icon={<Bot className="size-5" strokeWidth={1.5} />}
      title="Daily assistant"
      body="Briefings, reminders, and standup drafts. Nothing scheduled yet."
    />
  );
}
