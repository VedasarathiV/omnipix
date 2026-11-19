import { useState } from 'react';
import { Copy, Monitor, Smartphone, Tablet } from 'lucide-react';
import { useStudio } from '../state/store';
import { useLogs, useRun, type AgentStep } from '../lib/queries';

interface ShellSession {
  id: string;
  title: string;
  command: string;
  output: string;
}

/** Terminal sessions derived from the run's real shell steps. */
function sessionsFromSteps(steps: AgentStep[]): ShellSession[] {
  const sessions: ShellSession[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.kind !== 'tool_call') continue;
    const name = step.name ?? '';
    if (name !== 'shell_exec' && name !== 'run_check') continue;
    const args = (step.content.arguments ?? {}) as Record<string, unknown>;
    const command = String(args.command ?? name);
    const result = steps[i + 1];
    const output = result && result.kind === 'tool_result' && result.name === name
      ? String((result.content as Record<string, unknown>).result ?? '')
      : '(still running…)';
    sessions.push({ id: String(step.id), title: command.slice(0, 40), command, output });
  }
  return sessions;
}

export function TerminalPanel() {
  const { activeRunId, pushToast } = useStudio();
  const { data: run } = useRun(activeRunId, true);
  const [selected, setSelected] = useState<string | null>(null);
  if (activeRunId === null) {
    return <p className="px-3 py-6 text-center text-xs text-ink-faint">Shell output from the active run appears here.</p>;
  }
  const sessions = sessionsFromSteps(run?.steps ?? []);
  const active = sessions.find(s => s.id === selected) ?? sessions[sessions.length - 1];
  if (!sessions.length) {
    return <p className="px-3 py-6 text-center text-xs text-ink-faint">This run has not executed any shell commands yet.</p>;
  }
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 overflow-x-auto border-b border-line px-2 py-1.5">
        {sessions.map(s => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSelected(s.id)}
            className={`shrink-0 rounded-md px-2 py-1 font-mono text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              active.id === s.id ? 'bg-base-2 text-ink' : 'text-ink-faint hover:text-ink'
            }`}
          >
            {s.title}
          </button>
        ))}
        <span className="flex-1" />
        <button
          type="button"
          title="Copy output"
          aria-label="Copy output"
          onClick={() => pushToast('ok', 'Terminal output copied')}
          className="rounded-md p-1 text-ink-faint outline-none hover:bg-base-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Copy className="size-3.5" strokeWidth={1.5} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-base-0 p-3 font-mono text-[11px] leading-5" aria-live="polite">
        <p className="font-semibold text-ink">$ {active.command}</p>
        <p className="break-all whitespace-pre-wrap text-ink-dim">{active.output}</p>
      </div>
    </div>
  );
}

export function PreviewPanel() {
  const [device, setDevice] = useState<'desktop' | 'tablet' | 'phone'>('desktop');
  const widths = { desktop: '100%', tablet: '560px', phone: '340px' };
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        <span className="px-1 font-mono text-[11px] text-ink-dim">No preview server running</span>
        <span className="flex-1" />
        {(['desktop', 'tablet', 'phone'] as const).map(d => (
          <button
            key={d}
            type="button"
            title={`${d} preview`}
            aria-label={`${d} preview`}
            aria-pressed={device === d}
            onClick={() => setDevice(d)}
            className={`rounded-md p-1 outline-none focus-visible:ring-2 focus-visible:ring-accent ${device === d ? 'bg-base-2 text-ink' : 'text-ink-faint hover:text-ink'}`}
          >
            {d === 'desktop' ? <Monitor className="size-3.5" strokeWidth={1.5} /> : d === 'tablet' ? <Tablet className="size-3.5" strokeWidth={1.5} /> : <Smartphone className="size-3.5" strokeWidth={1.5} />}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto bg-base-0 p-3">
        <div style={{ width: widths[device] }} className="max-w-full rounded-xl border border-dashed border-line p-6 text-center">
          <p className="text-xs font-medium">Nothing to preview</p>
          <p className="mx-auto mt-1 max-w-60 text-[11px] leading-relaxed text-ink-dim">
            Have the agent start a dev server in the workspace, then point the preview at its URL.
          </p>
        </div>
      </div>
    </div>
  );
}

export function LogsPanel() {
  const { data } = useLogs();
  const entries = data?.entries ?? [];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-base-0 p-3 font-mono text-[11px] leading-5">
      {entries.length === 0 && <p className="text-ink-faint">No server log entries yet.</p>}
      {entries.map(entry => (
        <p key={entry.id} className="break-all whitespace-pre-wrap text-ink-dim">
          <span className="text-ink-faint">{entry.ts}</span> [{entry.level}]{entry.source ? `[${entry.source}]` : ''} {entry.message}
        </p>
      ))}
    </div>
  );
}
