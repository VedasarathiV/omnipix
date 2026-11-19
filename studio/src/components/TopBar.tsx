import { useState } from 'react';
import { Check, ChevronDown, FolderGit2, GitBranch, Plus } from 'lucide-react';
import { WORKSPACES } from '../mock/data';
import { StatusDot, statusLabel } from './StatusDot';
import { useStudio } from '../state/store';
import { MODELS } from '../mock/data';
import type { AgentMode } from '../types';

const MODES: Array<{ id: AgentMode; label: string; hint: string }> = [
  { id: 'ask', label: 'Ask', hint: 'Answer questions, no edits (⌘.)' },
  { id: 'plan', label: 'Plan', hint: 'Draft a plan for approval first' },
  { id: 'agent', label: 'Agent', hint: 'Edit, run, and verify autonomously' },
];

export function TopBar() {
  const { mode, setMode, model, setModel, runStatus, setRunStatus, elapsedSec } = useStudio();
  const [wsOpen, setWsOpen] = useState(false);
  const [ws, setWs] = useState(WORKSPACES[0]);
  const running = runStatus === 'running' || runStatus === 'thinking';

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-base-1 px-3">
      <div className="relative">
        <button
          type="button"
          onClick={() => setWsOpen(open => !open)}
          title="Switch workspace (⌘K)"
          className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent"
        >
          <FolderGit2 className="size-4 text-ink-dim" strokeWidth={1.5} />
          <span className="max-w-36 truncate">{ws.name}</span>
          <span className="flex items-center gap-1 rounded-md bg-base-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-dim">
            <GitBranch className="size-3" strokeWidth={1.5} />
            {ws.branch}
            {ws.dirty > 0 && <span className="text-warn">●{ws.dirty}</span>}
          </span>
          <ChevronDown className="size-4 text-ink-faint" strokeWidth={1.5} />
        </button>
        {wsOpen && (
          <div className="absolute left-0 top-full z-30 mt-1 w-64 rounded-xl border border-line bg-base-1 p-1 shadow-xl">
            {WORKSPACES.map(w => (
              <button
                key={w.id}
                type="button"
                onClick={() => { setWs(w); setWsOpen(false); }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent"
              >
                <FolderGit2 className="size-4 shrink-0 text-ink-dim" strokeWidth={1.5} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{w.name}</span>
                  <span className="block truncate font-mono text-[11px] text-ink-faint">{w.branch}{w.dirty > 0 ? ` · ${w.dirty} changes` : ''}</span>
                </span>
                {w.id === ws.id && <Check className="size-4 text-ok" strokeWidth={1.5} />}
              </button>
            ))}
            <button
              type="button"
              className="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-ink-dim outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Plus className="size-4" strokeWidth={1.5} /> Open folder…
            </button>
          </div>
        )}
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-1 rounded-lg bg-base-2 p-0.5" role="tablist" aria-label="Agent mode">
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

      <select
        aria-label="Model"
        title="Model (⌘M)"
        value={model}
        onChange={e => setModel(e.target.value)}
        className="max-w-48 rounded-lg border border-line bg-base-1 px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>

      <span className="hidden items-center gap-1.5 rounded-lg bg-base-2 px-2 py-1.5 font-mono text-[11px] text-ink-dim lg:flex" title="This run: 12.4k tokens · $0.09 · 2:27 elapsed">
        <StatusDot status={runStatus} pulse />
        {statusLabel(runStatus)} · {Math.floor(elapsedSec / 60)}:{String(elapsedSec % 60).padStart(2, '0')}
      </span>

      {running ? (
        <button
          type="button"
          title="Stop run (Esc)"
          onClick={() => setRunStatus('idle')}
          className="rounded-lg bg-bad px-3 py-1.5 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent"
        >
          Stop
        </button>
      ) : (
        <button
          type="button"
          title="Run (⌘Enter)"
          onClick={() => setRunStatus('running')}
          className="rounded-lg bg-ok px-3 py-1.5 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent"
        >
          Run
        </button>
      )}
    </header>
  );
}
