import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, FolderGit2, GitBranch } from 'lucide-react';
import { StatusDot, statusLabel } from './StatusDot';
import { ModelPicker } from './ModelPicker';
import { useStudio } from '../state/store';
import { apiFetch } from '../lib/api';
import { useGroups, useRun, useRuns } from '../lib/queries';
import type { AgentMode } from '../types';
import type { RunStatus } from '../types';

const MODES: Array<{ id: AgentMode; label: string; hint: string }> = [
  { id: 'ask', label: 'Ask', hint: 'Answer questions, no edits (⌘.)' },
  { id: 'plan', label: 'Plan', hint: 'Draft a plan for approval first' },
  { id: 'agent', label: 'Agent', hint: 'Edit, run, and verify autonomously' },
];

export function TopBar() {
  const { mode, setMode, activeRunId, setActiveRunId, setConversationId, pushToast, streamingReply } = useStudio();
  const queryClient = useQueryClient();
  const { data: runsData } = useRuns();
  const { data: groupsData } = useGroups();
  const { data: run } = useRun(activeRunId, true);
  const [wsOpen, setWsOpen] = useState(false);
  const runs = (runsData?.runs ?? []).slice(0, 6);
  const groups = (groupsData?.groups ?? []).filter(g => g.status === 'running').slice(0, 3);
  const active = runs.find(r => r.id === activeRunId) ?? null;
  const live: RunStatus =
    run?.status === 'running' ? 'running'
    : run?.status === 'awaiting_approval' ? 'waiting'
    : run?.status === 'error' ? 'failed'
    : run?.status === 'done' ? 'done'
    : streamingReply !== null ? 'thinking'
    : 'idle';
  const running = live === 'running' || live === 'thinking';
  const tokens = (run?.prompt_tokens ?? 0) + (run?.completion_tokens ?? 0);

  async function stopRun() {
    if (activeRunId === null) return;
    try {
      await apiFetch(`/api/agents/runs/${activeRunId}/stop`, { method: 'POST' });
      pushToast('ok', `Run #${activeRunId} stopped`);
      void queryClient.invalidateQueries({ queryKey: ['agent-runs'] });
      void queryClient.invalidateQueries({ queryKey: ['agent-run', activeRunId] });
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Stop failed');
    }
  }

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 overflow-x-auto border-b border-line bg-base-1 px-3">
      <div className="relative">
        <button
          type="button"
          onClick={() => setWsOpen(open => !open)}
          title="Switch work context (⌘K)"
          className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent"
        >
          <FolderGit2 className="size-4 text-ink-dim" strokeWidth={1.5} />
          <span className="max-w-36 truncate">{active ? `Run #${active.id}` : 'No run'}</span>
          {groups.length > 0 && (
            <span className="flex items-center gap-1 rounded-md bg-base-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-dim">
              <GitBranch className="size-3" strokeWidth={1.5} />
              {groups.length} team{groups.length === 1 ? '' : 's'}
            </span>
          )}
          <ChevronDown className="size-4 text-ink-faint" strokeWidth={1.5} />
        </button>
        {wsOpen && (
          <div className="absolute left-0 top-full z-30 mt-1 w-72 rounded-xl border border-line bg-base-1 p-1 shadow-xl">
            {runs.length === 0 && (
              <p className="px-2 py-3 text-center text-xs text-ink-faint">No runs yet — send an Agent message.</p>
            )}
            {runs.map(r => (
              <button
                key={r.id}
                type="button"
                onClick={() => { setActiveRunId(r.id); setConversationId(null); setWsOpen(false); }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent"
              >
                <FolderGit2 className="size-4 shrink-0 text-ink-dim" strokeWidth={1.5} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">Run #{r.id}</span>
                  <span className="block truncate font-mono text-[11px] text-ink-faint">{r.status} · {r.goal.slice(0, 60)}</span>
                </span>
                {r.id === activeRunId && <Check className="size-4 shrink-0 text-ok" strokeWidth={1.5} />}
              </button>
            ))}
            {groups.length > 0 && (
              <>
                <p className="px-2 pt-2 pb-1 text-[11px] font-medium text-ink-faint">Live teams</p>
                {groups.map(g => (
                  <div key={g.id} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm">
                    <GitBranch className="size-4 shrink-0 text-ink-dim" strokeWidth={1.5} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">Team #{g.id}</span>
                      <span className="block truncate font-mono text-[11px] text-ink-faint">{g.done_count}/{g.task_count} tasks</span>
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex-1" />

      <div className="hidden items-center gap-1 rounded-lg bg-base-2 p-0.5 md:flex" role="tablist" aria-label="Agent mode">
        {MODES.map(m => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={mode === m.id}
            title={m.hint}
            onClick={() => setMode(m.id)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              mode === m.id ? 'bg-base-0 text-ink shadow' : 'text-ink-dim hover:text-ink'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <ModelPicker />

      <span
        className="hidden items-center gap-1.5 rounded-lg bg-base-2 px-2 py-1.5 font-mono text-[11px] text-ink-dim lg:flex"
        title={run ? `Run #${run.id}: ${tokens} tokens · $${(run.cost_usd ?? 0).toFixed(2)}` : 'No active run'}
      >
        <StatusDot status={live} pulse />
        {statusLabel(live)}{run ? ` · ${(tokens / 1000).toFixed(1)}k` : ''}
      </span>

      {running && activeRunId !== null ? (
        <button
          type="button"
          title="Stop run (Esc)"
          onClick={() => void stopRun()}
          className="rounded-lg bg-bad px-3 py-1.5 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent"
        >
          Stop
        </button>
      ) : null}
    </header>
  );
}
