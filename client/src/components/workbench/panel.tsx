import type { KeyboardEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { useI18n } from '@/i18n'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'
import { LOG_POLL_MS, buildLogsQuery, type LogEntry, type LogsResponse } from '@/lib/logs'
import { statusDot, statusLabelKey, type HealthData } from '@/components/keys/shared'

export type PanelTab = 'logs' | 'health'

// The workbench bottom panel: a live log tail and a key-health glance,
// visible from any page. Both queries only run while their tab is showing.

const LEVEL_DOT: Record<string, string> = {
  debug: 'bg-muted-foreground/40',
  info: 'bg-primary',
  warn: 'bg-amber-500',
  error: 'bg-destructive',
}

function timeOf(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour12: false })
}

function LogsTail() {
  const { t } = useI18n()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['panel', 'logs'],
    queryFn: () => apiFetch<LogsResponse>(buildLogsQuery({ levels: ['error', 'warn', 'info'], limit: 50 })),
    refetchInterval: LOG_POLL_MS,
    refetchIntervalInBackground: false,
  })
  const entries: LogEntry[] = data?.entries ?? []
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed">
        {isLoading ? (
          <p className="text-muted-foreground">{t('common.loading')}</p>
        ) : isError ? (
          <p className="text-destructive">{t('logs.loadFailed')}</p>
        ) : entries.length === 0 ? (
          <p className="text-muted-foreground">{t('common.noData')}</p>
        ) : (
          entries.map(e => (
            <div key={e.id} className="flex items-baseline gap-2 whitespace-nowrap">
              <span className="shrink-0 tabular-nums text-muted-foreground/70">{timeOf(e.ts)}</span>
              <span className={cn('size-1.5 shrink-0 self-center rounded-full', LEVEL_DOT[e.level] ?? 'bg-muted-foreground/40')} aria-hidden="true" />
              <span className="truncate text-muted-foreground">{e.message}</span>
            </div>
          ))
        )}
      </div>
      <div className="shrink-0 border-t px-3 py-1">
        <Link to="/logs" className="text-[11px] font-medium text-primary underline-offset-4 hover:underline">
          {t('workbench.openFullLog')}
        </Link>
      </div>
    </div>
  )
}

function HealthGlance() {
  const { t } = useI18n()
  const { data, isLoading, isError } = useQuery<HealthData>({
    queryKey: ['health'],
    queryFn: () => apiFetch('/api/health'),
    // Same cadence as KeysPage: without it the glance never refreshes while
    // the user sits on any other page.
    refetchInterval: 30000,
  })
  const keys = data?.keys ?? []
  const healthy = keys.filter(k => k.status === 'healthy').length
  const attention = keys.filter(k => k.status !== 'healthy').slice(0, 8)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 text-[11px]">
        {isLoading ? (
          <p className="text-muted-foreground">{t('common.loading')}</p>
        ) : isError ? (
          <p className="text-destructive">{t('keys.loadFailed')}</p>
        ) : keys.length === 0 ? (
          <p className="text-muted-foreground">{t('common.noData')}</p>
        ) : (
          <>
            <p className="pb-1.5 text-muted-foreground">{t('workbench.keysHealthy', { healthy, total: keys.length })}</p>
            {attention.map(k => (
              <div key={k.id} className="flex items-center gap-2 py-0.5">
                <span className={cn('size-1.5 shrink-0 rounded-full', statusDot[k.status] ?? 'bg-muted-foreground/40')} aria-hidden="true" />
                <span className="font-mono">{k.platform}</span>
                <span className="text-muted-foreground">{t(statusLabelKey[k.status] ?? 'status.unchecked')}</span>
              </div>
            ))}
          </>
        )}
      </div>
      <div className="shrink-0 border-t px-3 py-1">
        <Link to="/keys" className="text-[11px] font-medium text-primary underline-offset-4 hover:underline">
          {t('workbench.viewAllKeys')}
        </Link>
      </div>
    </div>
  )
}

export interface PanelProps {
  tab: PanelTab
  onTabChange: (tab: PanelTab) => void
  onClose: () => void
}

export function Panel({ tab, onTabChange, onClose }: PanelProps) {
  const { t } = useI18n()
  const tabs: PanelTab[] = ['logs', 'health']
  const tabClass = (active: boolean) =>
    cn(
      'rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors',
      active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted',
    )
  const onTabKeyDown = (e: KeyboardEvent) => {
    const i = tabs.indexOf(tab)
    const next = e.key === 'ArrowRight' ? tabs[(i + 1) % tabs.length]
      : e.key === 'ArrowLeft' ? tabs[(i + tabs.length - 1) % tabs.length]
      : e.key === 'Home' ? tabs[0]
      : e.key === 'End' ? tabs[tabs.length - 1]
      : null
    if (!next || next === tab) return
    e.preventDefault()
    onTabChange(next)
    document.getElementById(`panel-tab-${next}`)?.focus()
  }
  return (
    <section aria-label={t('workbench.panel')} className="flex h-56 shrink-0 flex-col border-t bg-card">
      <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1" role="tablist" aria-label={t('workbench.panel')} onKeyDown={onTabKeyDown}>
        <button type="button" role="tab" id="panel-tab-logs" aria-selected={tab === 'logs'} aria-controls="panel-tabpanel" tabIndex={tab === 'logs' ? 0 : -1} onClick={() => onTabChange('logs')} className={tabClass(tab === 'logs')}>
          {t('workbench.panelLogs')}
        </button>
        <button type="button" role="tab" id="panel-tab-health" aria-selected={tab === 'health'} aria-controls="panel-tabpanel" tabIndex={tab === 'health' ? 0 : -1} onClick={() => onTabChange('health')} className={tabClass(tab === 'health')}>
          {t('workbench.panelHealth')}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('workbench.togglePanel')}
          title={t('workbench.togglePanel')}
          className="ml-auto rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronDown className="size-4" />
        </button>
      </div>
      <div role="tabpanel" id="panel-tabpanel" aria-labelledby={tab === 'logs' ? 'panel-tab-logs' : 'panel-tab-health'} className="flex min-h-0 flex-1 flex-col">
        {tab === 'logs' ? <LogsTail /> : <HealthGlance />}
      </div>
    </section>
  )
}
