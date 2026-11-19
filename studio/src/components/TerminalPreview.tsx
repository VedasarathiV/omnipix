import { useState } from 'react';
import { Copy, Monitor, Plus, Smartphone, Tablet, Trash2, X } from 'lucide-react';
import { LOGS, TERMINALS } from '../mock/data';
import { useStudio } from '../state/store';

export function TerminalPanel() {
  const { terminalId, setTerminalId, pushToast } = useStudio();
  const [sessions, setSessions] = useState(TERMINALS);
  const active = sessions.find(s => s.id === terminalId) ?? sessions[0];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        {sessions.map(s => (
          <button
            key={s.id}
            type="button"
            onClick={() => setTerminalId(s.id)}
            className={`flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              s.id === active.id ? 'bg-base-2 text-ink' : 'text-ink-faint hover:text-ink'
            }`}
          >
            {s.running && <span className="size-1.5 animate-pulse rounded-full bg-ok" />}
            {s.title}
          </button>
        ))}
        <button
          type="button"
          title="New terminal"
          aria-label="New terminal"
          onClick={() => {
            const id = `t${sessions.length + 1}`;
            setSessions(list => [...list, { id, title: `shell ${sessions.length + 1}`, running: false, lines: [] }]);
            setTerminalId(id);
          }}
          className="rounded-md p-1 text-ink-faint outline-none hover:bg-base-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Plus className="size-3.5" strokeWidth={1.5} />
        </button>
        <span className="flex-1" />
        <TermBtn label="Copy output" onClick={() => pushToast('ok', 'Terminal output copied')}>
          <Copy className="size-3.5" strokeWidth={1.5} />
        </TermBtn>
        <TermBtn label="Clear" onClick={() => setSessions(list => list.map(s => (s.id === active.id ? { ...s, lines: [] } : s)))}>
          <Trash2 className="size-3.5" strokeWidth={1.5} />
        </TermBtn>
        {active.running && (
          <TermBtn label="Kill session" onClick={() => setSessions(list => list.map(s => (s.id === active.id ? { ...s, running: false } : s)))}>
            <X className="size-3.5" strokeWidth={1.5} />
          </TermBtn>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-base-0 p-3 font-mono text-[11px] leading-5" aria-live="polite">
        {active.lines.length === 0 && <p className="text-ink-faint">$ — new shell ready</p>}
        {active.lines.map((line, i) => (
          <p
            key={i}
            className={`break-all whitespace-pre-wrap ${line.kind === 'cmd' ? 'font-semibold text-ink' : line.kind === 'err' ? 'text-bad' : 'text-ink-dim'}`}
          >
            {line.text}
          </p>
        ))}
        {active.running && <p className="animate-pulse text-accent">▊</p>}
      </div>
    </div>
  );
}

function TermBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="rounded-md p-1 text-ink-faint outline-none hover:bg-base-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
    >
      {children}
    </button>
  );
}

export function PreviewPanel() {
  const [device, setDevice] = useState<'desktop' | 'tablet' | 'phone'>('desktop');
  const widths = { desktop: '100%', tablet: '560px', phone: '340px' };
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        <span className="px-1 font-mono text-[11px] text-ink-dim">localhost:5174</span>
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
        <div style={{ width: widths[device] }} className="max-w-full overflow-hidden rounded-xl border border-line bg-base-1">
          <div className="border-b border-line px-3 py-2 text-xs font-semibold">Mock storefront</div>
          <div className="grid grid-cols-3 gap-2 p-3">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="rounded-lg bg-base-2 p-2">
                <div className="mb-1.5 h-10 rounded-md bg-base-0" />
                <div className="h-2 w-3/4 rounded bg-line" />
                <div className="mt-1 h-2 w-1/3 rounded bg-line" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function LogsPanel() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-base-0 p-3 font-mono text-[11px] leading-5">
      {LOGS.map((line, i) => (
        <p key={i} className="break-all whitespace-pre-wrap text-ink-dim">{line}</p>
      ))}
    </div>
  );
}
