import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

interface NotificationItem {
  id: number
  kind: string
  title: string
  body: string
  link: string
  read: number
  created_at: string
}

/**
 * Global notification bell: automation completions and parked approvals.
 * Polls lightly; the badge clears as items are read.
 */
export function NotificationBell({ className }: { className?: string }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data } = useQuery<{ notifications: NotificationItem[]; unread: number }>({
    queryKey: ['notifications'],
    queryFn: () => apiFetch('/api/notifications'),
    refetchInterval: 15000,
  })
  const unread = data?.unread ?? 0
  const items = data?.notifications ?? []

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['notifications'] })
  }

  const markRead = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: invalidate,
  })

  const readAll = useMutation({
    mutationFn: () => apiFetch('/api/notifications/read-all', { method: 'POST' }),
    onSuccess: invalidate,
  })

  function open(item: NotificationItem) {
    if (!item.read) markRead.mutate(item.id)
    if (item.link) navigate(item.link)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('notifications.title')}
        title={t('notifications.title')}
        className={cn(
          'relative flex size-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
          className,
        )}
      >
        <Bell className="size-5" strokeWidth={1.75} />
        {unread > 0 && (
          <span className="absolute top-1.5 right-1.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground tabular-nums">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="right" className="max-h-96 w-80 overflow-y-auto p-1.5">
        <div className="mb-1 flex items-center justify-between px-1.5 pt-1">
          <span className="text-xs font-medium">{t('notifications.title')}</span>
          {unread > 0 && (
            <Button variant="ghost" size="xs" onClick={() => readAll.mutate()} disabled={readAll.isPending}>
              {t('notifications.readAll')}
            </Button>
          )}
        </div>
        {items.length === 0 && (
          <p className="px-1.5 py-3 text-xs text-muted-foreground">{t('notifications.empty')}</p>
        )}
        {items.map(item => (
          <button
            key={item.id}
            type="button"
            onClick={() => open(item)}
            className={`flex w-full flex-col gap-0.5 rounded-lg px-1.5 py-2 text-left transition-colors hover:bg-muted ${item.read ? '' : 'bg-primary/5'}`}
          >
            <span className="text-xs font-medium">{item.title}</span>
            {item.body && (
              <span className="line-clamp-2 text-[11px] text-muted-foreground">{item.body}</span>
            )}
            <span className="font-mono text-[10px] text-muted-foreground">
              {new Date(item.created_at).toLocaleString()}
            </span>
          </button>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
