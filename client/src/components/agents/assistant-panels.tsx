import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Play, Plus, Trash2 } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export interface Memory {
  id: number
  scope: 'user' | 'project' | 'entity'
  project_key: string
  key: string
  value: string
  importance: number
  score: number
}

export function MemoryPanel() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')
  const [scope, setScope] = useState<'user' | 'project' | 'entity'>('user')
  const [project, setProject] = useState('')

  const { data: rows = [], isLoading } = useQuery<Memory[]>({
    queryKey: ['memories'],
    queryFn: () => apiFetch<{ memories: Memory[] }>('/api/memories').then(r => r.memories),
  })

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['memories'] })
  }

  const save = useMutation({
    mutationFn: () =>
      apiFetch('/api/memories', {
        method: 'POST',
        body: JSON.stringify({
          key: key.trim(), value: value.trim(), scope,
          ...(scope === 'project' ? { project: project.trim() } : {}),
        }),
      }),
    onSuccess: () => {
      setKey('')
      setValue('')
      setProject('')
      invalidate()
    },
  })

  const remove = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/memories/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  })

  const valid = key.trim() !== '' && value.trim() !== '' && (scope === 'user' || project.trim() !== '')

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{t('assistant.memoryTitle')}</CardTitle>
        <CardDescription>{t('assistant.memoryDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1">
            <Label htmlFor="memory-key" className="text-[11px]">{t('assistant.memoryKey')}</Label>
            <Input id="memory-key" value={key} onChange={e => setKey(e.target.value)} className="h-8 w-32 font-mono text-xs" />
          </div>
          <div className="grid min-w-40 flex-1 gap-1">
            <Label htmlFor="memory-value" className="text-[11px]">{t('assistant.memoryValue')}</Label>
            <Input id="memory-value" value={value} onChange={e => setValue(e.target.value)} className="h-8 text-xs" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="memory-scope" className="text-[11px]">{t('assistant.memoryScope')}</Label>
            <Select value={scope} onValueChange={v => { if (v === 'user' || v === 'project' || v === 'entity') setScope(v) }}>
              <SelectTrigger id="memory-scope" className="h-8 w-28 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">user</SelectItem>
                <SelectItem value="project">project</SelectItem>
                <SelectItem value="entity">entity</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {scope === 'project' && (
            <div className="grid gap-1">
              <Label htmlFor="memory-project" className="text-[11px]">{t('assistant.memoryProject')}</Label>
              <Input id="memory-project" value={project} onChange={e => setProject(e.target.value)} className="h-8 w-28 font-mono text-xs" />
            </div>
          )}
          <Button size="sm" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            <Plus /> {t('assistant.memoryAdd')}
          </Button>
        </div>
        {save.isError && (
          <p role="alert" className="text-xs text-destructive">{(save.error as Error).message}</p>
        )}
        {isLoading && <p className="text-xs text-muted-foreground">…</p>}
        {!isLoading && rows.length === 0 && (
          <p className="text-xs text-muted-foreground">{t('assistant.memoryEmpty')}</p>
        )}
        {rows.map(row => (
          <div key={row.id} className="flex items-start gap-3 rounded-xl border px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium font-mono">{row.key}</span>
                <Badge variant="outline" className="text-[10px]">
                  {row.scope}{row.scope === 'project' ? `:${row.project_key}` : ''}
                </Badge>
                <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                  {t('assistant.memoryScore')} {row.score.toFixed(2)}
                </span>
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">{row.value}</p>
            </div>
            <Button
              variant="ghost" size="icon-sm"
              aria-label={t('assistant.memoryDelete')}
              onClick={() => {
                if (window.confirm(t('assistant.memoryDeleteConfirm'))) remove.mutate(row.id)
              }}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

interface IngestedDoc {
  project_key: string
  source_url: string
  title: string
  chunks: number
  updated_at: string
}

export function DocsPanel() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [url, setUrl] = useState('')
  const [project, setProject] = useState('')

  const { data: rows = [], isLoading } = useQuery<IngestedDoc[]>({
    queryKey: ['ingested-docs'],
    queryFn: () => apiFetch<{ docs: IngestedDoc[] }>('/api/memories/docs').then(r => r.docs),
  })

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['ingested-docs'] })
  }

  const ingest = useMutation({
    mutationFn: () =>
      apiFetch('/api/memories/ingest', {
        method: 'POST',
        body: JSON.stringify({ url: url.trim(), project: project.trim() }),
      }),
    onSuccess: () => {
      setUrl('')
      setProject('')
      invalidate()
    },
  })

  const remove = useMutation({
    mutationFn: (row: IngestedDoc) =>
      apiFetch(`/api/memories/docs?project=${encodeURIComponent(row.project_key)}&url=${encodeURIComponent(row.source_url)}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  })

  const valid = url.trim() !== '' && project.trim() !== ''

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{t('assistant.docsTitle')}</CardTitle>
        <CardDescription>{t('assistant.docsDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid min-w-40 flex-1 gap-1">
            <Label htmlFor="docs-url" className="text-[11px]">{t('assistant.docsUrl')}</Label>
            <Input id="docs-url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://" className="h-8 font-mono text-xs" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="docs-project" className="text-[11px]">{t('assistant.docsProject')}</Label>
            <Input id="docs-project" value={project} onChange={e => setProject(e.target.value)} className="h-8 w-28 font-mono text-xs" />
          </div>
          <Button size="sm" disabled={!valid || ingest.isPending} onClick={() => ingest.mutate()}>
            <Plus /> {ingest.isPending ? t('assistant.docsIngesting') : t('assistant.docsIngest')}
          </Button>
        </div>
        {ingest.isError && (
          <p role="alert" className="text-xs text-destructive">{(ingest.error as Error).message}</p>
        )}
        {isLoading && <p className="text-xs text-muted-foreground">…</p>}
        {!isLoading && rows.length === 0 && (
          <p className="text-xs text-muted-foreground">{t('assistant.docsEmpty')}</p>
        )}
        {rows.map(row => (
          <div key={`${row.project_key}${row.source_url}`} className="flex items-start gap-3 rounded-xl border px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium">{row.title || row.source_url}</span>
                <Badge variant="outline" className="font-mono text-[10px]">
                  {row.project_key}
                </Badge>
                <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                  {t('assistant.docsChunks', { count: row.chunks })}
                </span>
              </p>
              <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{row.source_url}</p>
            </div>
            <Button
              variant="ghost" size="icon-sm"
              aria-label={t('assistant.docsDelete')}
              onClick={() => {
                if (window.confirm(t('assistant.docsDeleteConfirm'))) remove.mutate(row)
              }}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

export interface Automation {
  id: number
  name: string
  goal: string
  schedule: string
  model: string
  enabled: number
  reviewed: number
  last_run_id: number | null
  last_status: string | null
  last_run_at: string | null
  next_run_at: string | null
}

export function AutomationsPanel() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [goal, setGoal] = useState('')
  const [schedule, setSchedule] = useState('')

  const { data: rows = [], isLoading } = useQuery<Automation[]>({
    queryKey: ['automations'],
    queryFn: () => apiFetch<{ automations: Automation[] }>('/api/automations').then(r => r.automations),
  })

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['automations'] })
  }

  const save = useMutation({
    mutationFn: () =>
      apiFetch('/api/automations', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), goal: goal.trim(), schedule: schedule.trim() || undefined }),
      }),
    onSuccess: () => {
      setName('')
      setGoal('')
      setSchedule('')
      invalidate()
    },
  })

  const toggle = useMutation({
    mutationFn: (row: Automation) =>
      apiFetch(`/api/automations/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !row.enabled }),
      }),
    onSuccess: invalidate,
  })

  const remove = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/automations/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  })

  const runOnce = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/automations/${id}/run`, { method: 'POST' }),
    onSuccess: invalidate,
  })

  const valid = name.trim() !== '' && goal.trim() !== ''

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{t('assistant.autoTitle')}</CardTitle>
        <CardDescription>{t('assistant.autoDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1">
            <Label htmlFor="auto-name" className="text-[11px]">{t('assistant.autoName')}</Label>
            <Input id="auto-name" value={name} onChange={e => setName(e.target.value)} className="h-8 w-32 font-mono text-xs" />
          </div>
          <div className="grid min-w-40 flex-1 gap-1">
            <Label htmlFor="auto-goal" className="text-[11px]">{t('assistant.autoGoal')}</Label>
            <Input id="auto-goal" value={goal} onChange={e => setGoal(e.target.value)} className="h-8 text-xs" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="auto-schedule" className="text-[11px]">{t('assistant.autoSchedule')}</Label>
            <Input
              id="auto-schedule" value={schedule} onChange={e => setSchedule(e.target.value)}
              placeholder={t('assistant.autoSchedulePlaceholder')} className="h-8 w-32 font-mono text-xs"
            />
          </div>
          <Button size="sm" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            <Plus /> {t('assistant.autoNew')}
          </Button>
        </div>
        {save.isError && (
          <p role="alert" className="text-xs text-destructive">{(save.error as Error).message}</p>
        )}
        {isLoading && <p className="text-xs text-muted-foreground">…</p>}
        {!isLoading && rows.length === 0 && (
          <p className="text-xs text-muted-foreground">{t('assistant.autoEmpty')}</p>
        )}
        {rows.map(row => (
          <div key={row.id} className="flex items-start gap-3 rounded-xl border px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-xs font-medium">
                <span className="font-mono">{row.name}</span>
                <Badge variant={row.reviewed ? 'secondary' : 'outline'} className="text-[10px]">
                  {row.reviewed ? t('assistant.autoReviewed') : t('assistant.autoUnreviewed')}
                </Badge>
                {row.last_status && (
                  <Badge variant={row.last_status === 'done' ? 'secondary' : row.last_status === 'running' ? 'default' : 'destructive'} className="text-[10px]">
                    {row.last_status}
                  </Badge>
                )}
              </p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{row.goal}</p>
              <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                {row.schedule || '—'}
                {row.next_run_at && ` · ${t('assistant.autoNext')} ${new Date(row.next_run_at).toLocaleString()}`}
                {row.last_run_at && ` · ${t('assistant.autoLast')} ${new Date(row.last_run_at).toLocaleString()}`}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                variant="ghost" size="icon-sm"
                disabled={runOnce.isPending}
                onClick={() => runOnce.mutate(row.id)}
                aria-label={t('assistant.autoRun')}
              >
                <Play />
              </Button>
              <Switch
                checked={Boolean(row.enabled)}
                onCheckedChange={() => toggle.mutate(row)}
                aria-label={row.name}
              />
              <Button
                variant="ghost" size="icon-sm"
                aria-label={t('assistant.autoDelete')}
                onClick={() => {
                  if (window.confirm(t('assistant.autoDeleteConfirm'))) remove.mutate(row.id)
                }}
              >
                <Trash2 />
              </Button>
            </div>
          </div>
        ))}
        {runOnce.isError && (
          <p role="alert" className="text-xs text-destructive">{(runOnce.error as Error).message}</p>
        )}
      </CardContent>
    </Card>
  )
}

interface Scan {
  id: number
  trigger: string
  status: string
  workspace_count: number
  finding_count: number
  new_count: number
  error: string | null
  finished_at: string
}

interface ScanFinding {
  id: number
  scan_id: number
  workspace: string
  pattern: string
  severity: string
  file: string
  line: number
  excerpt: string
}

interface ScanSettings {
  enabled: boolean
  schedule: string
  nextRunAt: string | null
}

const SEVERITY_VARIANT: Record<string, 'destructive' | 'default' | 'outline'> = {
  high: 'destructive',
  medium: 'default',
  low: 'outline',
}

export function ScansPanel() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [openId, setOpenId] = useState<number | null>(null)
  const [schedule, setSchedule] = useState('')

  const { data, isLoading } = useQuery<{ scans: Scan[]; settings: ScanSettings }>({
    queryKey: ['security-scans'],
    queryFn: () => apiFetch('/api/agents/scans'),
  })
  const scans = data?.scans ?? []
  const settings = data?.settings

  const { data: detail } = useQuery<{ scan: Scan; findings: ScanFinding[] }>({
    queryKey: ['security-scan', openId],
    queryFn: () => apiFetch(`/api/agents/scans/${openId}`),
    enabled: openId != null,
  })

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['security-scans'] })
  }

  const runNow = useMutation({
    mutationFn: () => apiFetch('/api/agents/scans', { method: 'POST' }),
    onSuccess: () => {
      setOpenId(null)
      invalidate()
    },
  })

  const saveSettings = useMutation({
    mutationFn: (patch: { enabled?: boolean; schedule?: string }) =>
      apiFetch('/api/agents/scans-settings', { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => {
      setSchedule('')
      invalidate()
    },
  })

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{t('assistant.scanTitle')}</CardTitle>
        <CardDescription>{t('assistant.scanDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {settings && (
            <Switch
              checked={settings.enabled}
              onCheckedChange={enabled => saveSettings.mutate({ enabled })}
              aria-label={settings.enabled ? t('assistant.scanDisable') : t('assistant.scanEnable')}
            />
          )}
          <Input
            value={schedule}
            onChange={e => setSchedule(e.target.value)}
            placeholder={settings?.schedule ?? t('assistant.scanSchedulePlaceholder')}
            aria-label={t('assistant.scanSchedule')}
            className="h-8 w-32 font-mono text-xs"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!schedule.trim() || saveSettings.isPending}
            onClick={() => saveSettings.mutate({ schedule: schedule.trim() })}
          >
            {t('assistant.scanSave')}
          </Button>
          <Button size="sm" disabled={runNow.isPending} onClick={() => runNow.mutate()}>
            {runNow.isPending ? t('assistant.scanRunning') : t('assistant.scanRun')}
          </Button>
          {settings?.nextRunAt && settings.enabled && (
            <span className="text-[11px] text-muted-foreground">
              {new Date(settings.nextRunAt).toLocaleString()}
            </span>
          )}
        </div>
        {(runNow.isError || saveSettings.isError) && (
          <p role="alert" className="text-xs text-destructive">
            {((runNow.error ?? saveSettings.error) as Error).message}
          </p>
        )}
        {isLoading && <p className="text-xs text-muted-foreground">…</p>}
        {!isLoading && scans.length === 0 && (
          <p className="text-xs text-muted-foreground">{t('assistant.scanEmpty')}</p>
        )}
        {scans.map(scan => {
          const open = openId === scan.id
          return (
            <div key={scan.id} className="rounded-xl border">
              <button
                type="button"
                onClick={() => setOpenId(open ? null : scan.id)}
                aria-expanded={open}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
              >
                <span className="font-mono text-muted-foreground">#{scan.id}</span>
                <span className="min-w-0 flex-1 truncate">
                  {t('assistant.scanWorkspaces', { count: scan.workspace_count })}
                  {' · '}
                  {t('assistant.scanFindings', { count: scan.finding_count })}
                  {scan.new_count > 0 && ` · ${t('assistant.scanNew', { count: scan.new_count })}`}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {new Date(scan.finished_at).toLocaleString()}
                </span>
              </button>
              {open && (
                <div className="flex flex-col gap-1 border-t px-3 py-2">
                  {detail && detail.findings.length === 0 && (
                    <p className="text-xs text-muted-foreground">{t('assistant.scanNoFindings')}</p>
                  )}
                  {detail?.findings.map(f => (
                    <p key={f.id} className="flex items-start gap-1.5 text-[11px]">
                      <Badge variant={SEVERITY_VARIANT[f.severity] ?? 'outline'} className="mt-0.5 shrink-0 text-[10px]">
                        {f.severity}
                      </Badge>
                      <span className="min-w-0 flex-1">
                        <span className="font-mono">{f.workspace}/{f.file}:{f.line}</span>
                        <span className="text-muted-foreground"> [{f.pattern}]</span>
                        <span className="block truncate font-mono text-muted-foreground">{f.excerpt}</span>
                      </span>
                    </p>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
