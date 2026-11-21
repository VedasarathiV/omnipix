import { useEffect, useRef, useState } from 'react';
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
    // Pair with the matching result, scanning past interleaved hook steps.
    let output = '(still running…)';
    for (let j = i + 1; j < steps.length; j++) {
      if (steps[j].kind === 'tool_call') break;
      if (steps[j].kind === 'tool_result' && steps[j].name === name) {
        output = String((steps[j].content as Record<string, unknown>).result ?? '');
        break;
      }
    }
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
  const [cwd, setCwd] = useState('');
  const [running, setRunning] = useState(false);

  async function exec() {
    const cmd = command.trim();
    if (!cmd || running) return;
    setRunning(true);
    try {
      // With an active run, commands execute in its workspace; otherwise
      // they run in the standalone terminal (workspace root, or the cwd
      // below — absolute project paths allowed).
      const endpoint = activeRunId === null ? '/api/terminal/exec' : `/api/agents/runs/${activeRunId}/exec`;
      const body: Record<string, unknown> = { command: cmd };
      if (activeRunId === null && cwd.trim()) body.cwd = cwd.trim();
      const res = await apiFetch<{ stdout: string; stderr: string; exitCode: number | null; timedOut: boolean; durationMs: number }>(
        endpoint,
        { method: 'POST', body: JSON.stringify(body) },
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
  const cwdRow = activeRunId === null ? (
    <div className="flex shrink-0 items-center gap-1.5 border-t border-line bg-base-1 px-2 py-1.5">
      <span className="shrink-0 font-mono text-[11px] text-ink-faint">cwd</span>
      <input
        value={cwd}
        onChange={e => setCwd(e.target.value)}
        placeholder="workspace root — or an absolute project path"
        spellCheck={false}
        autoComplete="off"
        aria-label="Working directory"
        className="min-w-0 flex-1 rounded-md bg-transparent px-1 py-0.5 font-mono text-[11px] outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent"
      />
    </div>
  ) : null;
  if (!sessions.length) {
    return (
      <div className="flex h-full flex-col">
        <p className="flex-1 px-3 py-6 text-center text-xs text-ink-faint">
          {activeRunId === null
            ? 'No shell sessions yet. Type a command below — npm install works here.'
            : 'This run has not executed any shell commands yet.'}
        </p>
        {cwdRow}
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
          onClick={() => {
            void navigator.clipboard.writeText(`$ ${active.command}\n${active.output}`).then(
              () => pushToast('ok', 'Terminal output copied'),
              () => pushToast('error', 'Copy failed — clipboard unavailable'),
            );
          }}
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
      {cwdRow}
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

function loadPreviewUrl(): string {
  try {
    return window.localStorage.getItem('studio.previewUrl') ?? '';
  } catch {
    return '';
  }
}

function validPreviewUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function PreviewPanel() {
  const [device, setDevice] = useState<'desktop' | 'tablet' | 'phone'>('desktop');
  const [draft, setDraft] = useState(loadPreviewUrl);
  const [url, setUrl] = useState<string | null>(() => validPreviewUrl(loadPreviewUrl()));
  const [error, setError] = useState('');
  const widths = { desktop: '100%', tablet: '560px', phone: '340px' };
  function apply() {
    const next = validPreviewUrl(draft);
    if (draft.trim() && !next) {
      setError('Enter an http(s) URL, e.g. http://127.0.0.1:5173');
      return;
    }
    setError('');
    setUrl(next);
    try {
      if (next) window.localStorage.setItem('studio.previewUrl', next);
      else window.localStorage.removeItem('studio.previewUrl');
    } catch {
      // Private mode: preference just doesn't persist.
    }
  }
  return (
    <div className="flex h-full flex-col">
      <form
        onSubmit={e => { e.preventDefault(); apply(); }}
        className="flex shrink-0 items-center gap-1.5 border-b border-line px-2 py-1.5"
      >
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="http://127.0.0.1:5173"
          aria-label="Preview URL"
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 rounded-md bg-transparent px-1 py-0.5 font-mono text-[11px] outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent"
        />
        <button
          type="submit"
          className="shrink-0 rounded-md bg-accent px-2 py-1 text-[11px] font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent"
        >
          Load
        </button>
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
      </form>
      {error && <p role="alert" className="shrink-0 px-3 py-1 text-[11px] text-bad">{error}</p>}
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto bg-base-0 p-3">
        {url ? (
          <iframe
            key={url}
            title="Workspace preview"
            src={url}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            style={{ width: widths[device] }}
            className="h-full max-w-full rounded-xl border border-line bg-base-1"
          />
        ) : (
          <div style={{ width: widths[device] }} className="max-w-full rounded-xl border border-dashed border-line p-6 text-center">
            <p className="text-xs font-medium">Nothing to preview</p>
            <p className="mx-auto mt-1 max-w-60 text-[11px] leading-relaxed text-ink-dim">
              Have the agent start a dev server in the workspace, then paste its URL above.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

const LOG_LEVELS = ['all', 'trace', 'debug', 'info', 'warn', 'error'] as const;

export function LogsPanel() {
  const [level, setLevel] = useState<(typeof LOG_LEVELS)[number]>('all');
  const [query, setQuery] = useState('');
  const [follow, setFollow] = useState(true);
  const { data } = useLogs(level === 'all' ? undefined : level, query.trim() || undefined);
  const entries = data?.entries ?? [];
  const boxRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  useEffect(() => {
    const box = boxRef.current;
    if (follow && pinnedRef.current && box) box.scrollTop = box.scrollHeight;
  }, [entries, follow]);

  function onScroll() {
    const box = boxRef.current;
    if (!box) return;
    pinnedRef.current = box.scrollHeight - box.scrollTop - box.clientHeight < 48;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-line px-2 py-1.5">
        <select
          value={level}
          onChange={e => setLevel(e.target.value as (typeof LOG_LEVELS)[number])}
          aria-label="Log level filter"
          className="rounded-md bg-transparent px-1 py-0.5 font-mono text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {LOG_LEVELS.map(l => <option key={l} value={l}>{l === 'all' ? 'all levels' : l}</option>)}
        </select>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Filter text…"
          aria-label="Filter logs"
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 rounded-md bg-transparent px-1 py-0.5 font-mono text-[11px] outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent"
        />
        <button
          type="button"
          title={follow ? 'Following latest (on)' : 'Follow latest (off)'}
          aria-label="Follow latest logs"
          aria-pressed={follow}
          onClick={() => setFollow(f => !f)}
          className={`shrink-0 rounded-md px-2 py-1 font-mono text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-accent ${follow ? 'bg-base-2 text-ink' : 'text-ink-faint hover:text-ink'}`}
        >
          follow
        </button>
      </div>
      <div ref={boxRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto bg-base-0 p-3 font-mono text-[11px] leading-5">
        {entries.length === 0 && <p className="text-ink-faint">No server log entries yet.</p>}
        {entries.map(entry => (
          <p key={entry.id} className="break-all whitespace-pre-wrap text-ink-dim">
            <span className="text-ink-faint">{entry.ts}</span> [{entry.level}]{entry.source ? `[${entry.source}]` : ''} {entry.message}
          </p>
        ))}
      </div>
    </div>
  );
}
