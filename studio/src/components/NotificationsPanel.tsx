import { useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import { EmptyState } from './EmptyState';
import { useStudio } from '../state/store';
import { apiFetch } from '../lib/api';
import { useNotifications } from '../lib/queries';

const KIND_STYLE: Record<string, string> = {
  'automation-done': 'bg-ok',
  'automation-failed': 'bg-bad',
  'approval-pending': 'bg-warn',
  'security-scan': 'bg-bad',
};

function dot(kind: string, read: boolean): string {
  if (read) return 'bg-line';
  return KIND_STYLE[kind] ?? 'bg-info';
}

function ts(createdAt: string): string {
  const ms = Date.parse(createdAt);
  if (Number.isNaN(ms)) return '';
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function NotificationsPanel() {
  const { pushToast } = useStudio();
  const queryClient = useQueryClient();
  const { data } = useNotifications();
  const notices = data?.notifications ?? [];

  async function markAll() {
    try {
      await apiFetch('/api/notifications/read-all', { method: 'POST' });
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Mark-read failed');
    }
  }

  async function markOne(id: number) {
    try {
      await apiFetch(`/api/notifications/${id}/read`, { method: 'POST' });
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    } catch {
      // Best-effort; the list refreshes anyway.
    }
  }

  if (!notices.length) {
    return <EmptyState icon={<Bell className="size-5" strokeWidth={1.5} />} title="No notifications" body="Run completions, approvals, and errors land here." />;
  }
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold">Notifications{data && data.unread > 0 ? ` (${data.unread})` : ''}</h2>
        <button
          type="button"
          onClick={() => void markAll()}
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-ink-dim outline-none hover:bg-base-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
        >
          <CheckCheck className="size-3.5" strokeWidth={1.5} /> Mark all read
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {notices.map(n => (
          <button
            key={n.id}
            type="button"
            onClick={() => void markOne(n.id)}
            className="flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left outline-none hover:bg-base-1 focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span className={`mt-1.5 size-2 shrink-0 rounded-full ${dot(n.kind, !!n.read)}`} />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[13px] font-medium">{n.title}</span>
                <span className="shrink-0 text-[11px] text-ink-faint">{ts(n.created_at)}</span>
              </span>
              <span className="mt-0.5 block truncate font-mono text-[11px] text-ink-dim">{n.body}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
