import { useState } from 'react';
import { Copy, Monitor, Smartphone, Tablet } from 'lucide-react';
import { useStudio } from '../state/store';
import { apiFetch } from '../lib/api';
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

export interface ExecSession extends ShellSession {
  exitCode: number | null;
  durationMs: number;
}

export function TerminalPanel() {
  const { activeRunId, pushToast } = useStudio();
  const { data: run } = useRun(activeRunId, true);
  const [selected, setSelected] = useState<string | null>(null);
  const [local, setLocal] = useState<ExecSession[]>([]);
  const [command, setCommand] = useState('');
  const [running, setRunning] = useState(false);
  if (activeRunId === null) {
    return <p className="px-3 py-6 text-center text-xs text-ink-faint">Shell output from the active run appears here.</p>;
  }

  async function exec() {
    const cmd = command.trim();
    if (!cmd || running || activeRunId === null) return;
    setRunning(true);
    try {
      const res = await apiFetch<{ stdout: string; stderr: string; exitCode: number | null; timedOut: boolean; durationMs: number }>(
        `/api/agents/runs/${activeRunId}/exec`,
        { method: 'POST', body: JSON.stringify({ command: cmd }) },
      );
      const errText = res.stderr ? `\n${res.stderr}` : '';
      const session: ExecSession = {
        id: `exec-${Date.now()}`,
        title: cmd.slice(0, 40),
        command: cmd,
        output: `${res.stdout}${errText}`.trim() || `(exit ${res.exitCode ?? '?'})`,
        exitCode: res.exitCode,
        durationMs: res.durationMs,
      };
      setLocal(list => [...list, session]);
      setSelected(session.id);
      setCommand('');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Exec failed');
    } finally {
      setRunning(false);
    }
  }

  const sessions = [...sessionsFromSteps(run?.steps ?? []), ...local];
  const active = sessions.find(s => s.id === selected) ?? sessions[sessions.length - 1];
  if (!sessions.length) {
    return (
      <div className="flex h-full flex-col">
        <p className="flex-1 px-3 py-6 text-center text-xs text-ink-faint">This run has not executed any shell commands yet.</p>
        <ExecInput command={command} setCommand={setCommand} running={running} onRun={() => void exec()} />
      </div>
    );
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
        {'exitCode' in active && (
          <p className="mt-1 text-ink-faint">
            exit {(active as ExecSession).exitCode ?? '?'} · {((active as ExecSession).durationMs / 1000).toFixed(1)}s
          </p>
        )}
      </div>
      <ExecInput command={command} setCommand={setCommand} running={running} onRun={() => void exec()} />
    </div>
  );
}

function ExecInput({ command, setCommand, running, onRun }: {
  command: string;
  setCommand: (c: string) => void;
  running: boolean;
  onRun: () => void;
}) {
  return (
    <form
      onSubmit={e => { e.preventDefault(); onRun(); }}
      className="flex shrink-0 items-center gap-1.5 border-t border-line bg-base-1 px-2 py-1.5"
    >
      <span className="shrink-0 font-mono text-[11px] text-ok">$</span>
      <input
        value={command}
        onChange={e => setCommand(e.target.value)}
        placeholder="Run in workspace… (npm test, ls, …)"
        aria-label="Run command in workspace"
        spellCheck={false}
        autoComplete="off"
        className="min-w-0 flex-1 bg-transparent font-mono text-[11px] outline-none placeholder:text-ink-faint"
      />
      <button
        type="submit"
        disabled={!command.trim() || running}
        className="shrink-0 rounded-md bg-accent px-2 py-1 text-[11px] font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
      >
        {running ? '…' : 'Run'}
      </button>
    </form>
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
