import { Bell, CheckCheck } from 'lucide-react';
import { NOTICES } from '../mock/data';
import { EmptyState } from './EmptyState';
import { useStudio } from '../state/store';

const KIND_STYLE: Record<string, string> = {
  run: 'text-ok',
  approval: 'text-warn',
  error: 'text-bad',
  info: 'text-info',
};

export function NotificationsPanel() {
  const { pushToast } = useStudio();
  if (!NOTICES.length) {
    return <EmptyState icon={<Bell className="size-5" strokeWidth={1.5} />} title="No notifications" body="Run completions, approvals, and errors land here." />;
  }
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold">Notifications</h2>
        <button
          type="button"
          onClick={() => pushToast('ok', 'All notifications marked read')}
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-ink-dim outline-none hover:bg-base-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
        >
          <CheckCheck className="size-3.5" strokeWidth={1.5} /> Mark all read
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {NOTICES.map(n => (
          <button
            key={n.id}
            type="button"
            className="flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left outline-none hover:bg-base-1 focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span className={`mt-1.5 size-2 shrink-0 rounded-full ${n.read ? 'bg-line' : KIND_STYLE[n.kind].replace('text-', 'bg-')}`} />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[13px] font-medium">{n.title}</span>
                <span className="shrink-0 text-[11px] text-ink-faint">{n.ts}</span>
              </span>
              <span className="mt-0.5 block truncate font-mono text-[11px] text-ink-dim">{n.body}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
