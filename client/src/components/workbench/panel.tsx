import type { KeyboardEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ChevronDown, CornerDownLeft } from 'lucide-react'
import { useI18n } from '@/i18n'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'
import { LOG_POLL_MS, buildLogsQuery, type LogEntry, type LogsResponse } from '@/lib/logs'
import { FOLDER_CHANGED_EVENT, useOpenFolder } from '@/lib/open-folder'
import { statusDot, statusLabelKey, type HealthData } from '@/components/keys/shared'

export type PanelTab = 'logs' | 'health' | 'terminal' | 'files'

// The workbench bottom panel: a live log tail, a key-health glance, a
// standalone terminal, and a file browser — visible from any page.
// Queries only run while their tab is showing.

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

interface TermLine {
  kind: 'cmd' | 'out' | 'err'
  text: string
}

interface ExecResult {
  stdout?: string
  stderr?: string
  output?: string
  exitCode?: number
  code?: number
  error?: string
  cwd?: string
}

function TerminalPane() {
  const { t } = useI18n()
  const [openFolder] = useOpenFolder()
  const [lines, setLines] = useState<TermLine[]>([])
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [cwd, setCwd] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (el && typeof el.scrollTo === 'function') el.scrollTo({ top: el.scrollHeight })
  }, [lines])
  useEffect(() => {
    apiFetch<{ cwd: string }>('/api/terminal/cwd')
      .then(r => setCwd(r.cwd))
      .catch(() => setCwd(null))
  }, [])
  // Commands run inside the open project folder when one is open — the
  // server default (a tmp workspaces dir) is meaningless to the user.
  const execCwd = openFolder?.root ?? cwd

  const run = async () => {
    const command = input.trim()
    if (!command || running) return
    setInput('')
    setLines(prev => [...prev, { kind: 'cmd', text: `$ ${command}` }])
    setRunning(true)
    try {
      const r = await apiFetch<ExecResult>('/api/terminal/exec', {
        method: 'POST',
        body: JSON.stringify(execCwd ? { command, cwd: execCwd } : { command }),
      })
      const out = (r.output ?? r.stdout ?? '').trimEnd()
      const err = (r.stderr ?? r.error ?? '').trimEnd()
      const code = r.exitCode ?? r.code ?? 0
      setLines(prev => [
        ...prev,
        ...(out ? [{ kind: 'out' as const, text: out }] : []),
        ...(err ? [{ kind: 'err' as const, text: err }] : []),
        ...(code !== 0 && !err ? [{ kind: 'err' as const, text: t('terminal.exitCode', { code }) }] : []),
      ])
    } catch (err) {
      setLines(prev => [...prev, { kind: 'err', text: err instanceof Error ? err.message : String(err) }])
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed">
        {lines.length === 0 ? (
          <p className="text-muted-foreground">{t('terminal.empty')}</p>
        ) : (
          lines.map((l, i) => (
            <div
              key={i}
              className={cn(
                'whitespace-pre-wrap break-words',
                l.kind === 'cmd' && 'font-semibold text-foreground',
                l.kind === 'err' && 'text-destructive',
                l.kind === 'out' && 'text-muted-foreground',
              )}
            >
              {l.text}
            </div>
          ))
        )}
        {running && <p className="animate-pulse text-muted-foreground">…</p>}
      </div>
      <form
        className="flex shrink-0 items-center gap-2 border-t px-3 py-1.5"
        onSubmit={e => { e.preventDefault(); void run() }}
      >
        <span className="max-w-[40%] shrink-0 truncate font-mono text-[11px] text-muted-foreground" title={execCwd ?? ''}>
          {execCwd ?? '…'}
        </span>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={t('terminal.placeholder')}
          aria-label={t('terminal.placeholder')}
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent font-mono text-[11px] outline-none placeholder:text-muted-foreground/60"
        />
        <button
          type="submit"
          disabled={running || !input.trim()}
          aria-label={t('terminal.run')}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
        >
          <CornerDownLeft className="size-3.5" />
        </button>
      </form>
    </div>
  )
}

interface FsEntry {
  path: string
  kind: 'file' | 'dir'
  size?: number
}

function FilesPane() {
  const { t } = useI18n()
  const [root, setRoot] = useState(() => {
    try { return localStorage.getItem('panel.filesRoot') ?? '' } catch { return '' }
  })
  const [entries, setEntries] = useState<FsEntry[] | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  // Follow the shared opened folder: picking one elsewhere (sidebar) while
  // this tab is showing re-roots AND re-browses instead of stranding it.
  const browse = useCallback(async (dir: string) => {
    const r = dir.trim()
    if (!r) return
    setLoading(true)
    setError(null)
    setSelected(null)
    setPreview(null)
    try {
      const res = await apiFetch<{ root: string; entries: FsEntry[]; truncated: boolean }>(
        `/api/fs/list?root=${encodeURIComponent(r)}`,
      )
      setRoot(res.root)
      try { localStorage.setItem('panel.filesRoot', res.root) } catch { /* ignore */ }
      setEntries(res.entries)
      setTruncated(res.truncated)
    } catch (err) {
      setEntries(null)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const sync = () => {
      try {
        const raw = localStorage.getItem('omnipix.openFolder')
        const root = raw ? (JSON.parse(raw) as { root?: string }).root : ''
        if (root) void browse(root)
      } catch { /* ignore */ }
    }
    window.addEventListener(FOLDER_CHANGED_EVENT, sync)
    return () => window.removeEventListener(FOLDER_CHANGED_EVENT, sync)
  }, [browse])

  const openFile = async (path: string) => {
    setSelected(path)
    setPreview(null)
    try {
      const res = await apiFetch<{ content?: string; text?: string }>(
        `/api/fs/read?root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}`,
      )
      setPreview(res.content ?? res.text ?? '')
    } catch (err) {
      setPreview(err instanceof Error ? err.message : String(err))
    }
  }

  const q = filter.trim().toLowerCase()
  const shown = (entries ?? []).filter(e => !q || e.path.toLowerCase().includes(q)).slice(0, 400)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <form
        className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5"
        onSubmit={e => { e.preventDefault(); void browse(root) }}
      >
        <input
          value={root}
          onChange={e => setRoot(e.target.value)}
          placeholder={t('files.rootPlaceholder')}
          aria-label={t('files.rootPlaceholder')}
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent font-mono text-[11px] outline-none placeholder:text-muted-foreground/60"
        />
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder={t('files.filterPlaceholder')}
          aria-label={t('files.filterPlaceholder')}
          spellCheck={false}
          autoComplete="off"
          className="w-32 shrink-0 rounded-md border bg-transparent px-2 py-0.5 text-[11px] outline-none placeholder:text-muted-foreground/60"
        />
      </form>
      <div className="grid min-h-0 flex-1 grid-cols-2">
        <div className="min-h-0 overflow-y-auto border-e px-3 py-2 font-mono text-[11px] leading-relaxed">
          {loading ? (
            <p className="text-muted-foreground">{t('common.loading')}</p>
          ) : error ? (
            <p className="text-destructive">{error}</p>
          ) : entries === null ? (
            <p className="text-muted-foreground">{t('files.empty')}</p>
          ) : shown.length === 0 ? (
            <p className="text-muted-foreground">{t('common.noData')}</p>
          ) : (
            <>
              {shown.map(e => (
                <button
                  key={e.path}
                  type="button"
                  onClick={() => void openFile(e.path)}
                  className={cn(
                    'block w-full truncate rounded px-1 py-px text-left',
                    selected === e.path ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  {e.path}
                </button>
              ))}
              {truncated && <p className="px-1 py-1 text-muted-foreground">{t('files.truncated')}</p>}
            </>
          )}
        </div>
        <div className="min-h-0 overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed">
          {preview === null ? (
            <p className="text-muted-foreground">{selected ? t('common.loading') : t('files.selectHint')}</p>
          ) : (
            <pre className="whitespace-pre-wrap break-words text-muted-foreground">{preview}</pre>
          )}
        </div>
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
  const tabs: PanelTab[] = ['logs', 'health', 'terminal', 'files']
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
        <button type="button" role="tab" id="panel-tab-terminal" aria-selected={tab === 'terminal'} aria-controls="panel-tabpanel" tabIndex={tab === 'terminal' ? 0 : -1} onClick={() => onTabChange('terminal')} className={tabClass(tab === 'terminal')}>
          {t('workbench.panelTerminal')}
        </button>
        <button type="button" role="tab" id="panel-tab-files" aria-selected={tab === 'files'} aria-controls="panel-tabpanel" tabIndex={tab === 'files' ? 0 : -1} onClick={() => onTabChange('files')} className={tabClass(tab === 'files')}>
          {t('workbench.panelFiles')}
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
      <div role="tabpanel" id="panel-tabpanel" aria-labelledby={`panel-tab-${tab}`} className="flex min-h-0 flex-1 flex-col">
        {tab === 'logs' ? <LogsTail /> : tab === 'health' ? <HealthGlance /> : tab === 'terminal' ? <TerminalPane /> : <FilesPane />}
      </div>
    </section>
  )
}
