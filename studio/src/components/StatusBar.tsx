import { Bell, Cpu, KeyRound } from 'lucide-react';
import { useStudio } from '../state/store';
import { useKeys, useNotifications, useRun } from '../lib/queries';
import { StatusDot, statusLabel } from './StatusDot';

// IDE-style status bar: always-visible live state — model, run, keys,
// notifications. Every item is real data; the bell jumps to notifications.
export function StatusBar() {
  const { model, mode, activeRunId, setRail } = useStudio();
  const { data: run } = useRun(activeRunId, true);
  const { data: notifications } = useNotifications();
  const { data: keys = [] } = useKeys();
  const unread = notifications?.unread ?? 0;
  const configured = keys.filter(k => k.enabled).length;
  const live = run?.status === 'running' ? 'running'
    : run?.status === 'awaiting_approval' ? 'waiting'
    : run?.status === 'error' ? 'failed'
    : run?.status === 'done' ? 'done'
    : 'idle';

  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-line bg-base-1 px-3 font-mono text-[11px] text-ink-dim">
      <span className="flex items-center gap-1.5" title="Active model">
        <Cpu className="size-3.5" strokeWidth={1.5} />
        {model === 'auto' ? 'Auto' : model}
        <span className="text-ink-faint">· {mode}</span>
      </span>
      <span className="flex items-center gap-1.5" title={activeRunId === null ? 'No active run' : `Run #${activeRunId}`}>
        <StatusDot status={live} />
        {activeRunId === null ? 'no run' : `#${activeRunId} ${statusLabel(live)}`}
      </span>
      <span className="flex-1" />
      <span className="flex items-center gap-1.5" title="Enabled provider keys">
        <KeyRound className="size-3.5" strokeWidth={1.5} />
        {configured} key{configured === 1 ? '' : 's'}
      </span>
      <button
        type="button"
        onClick={() => setRail('notifications')}
        title="Open notifications"
        className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Bell className="size-3.5" strokeWidth={1.5} />
        {unread > 0 ? (
          <span className="rounded-full bg-accent px-1.5 text-[10px] font-bold text-base-0">{unread}</span>
        ) : (
          <span>0</span>
        )}
      </button>
    </footer>
  );
}
