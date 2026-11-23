import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Check, ChevronDown, FlaskConical, Loader2, X } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { useI18n } from '@/i18n'
import { ARENA_MAX_MODELS } from './compare-panel'
import { useRunnableModels } from './use-runnable-models'

interface SuiteItem {
  id: string
  prompt: string
  checks: Array<{ type: string; value?: string }>
}

export interface EvalSuite {
  id: number
  name: string
  description: string
  items: SuiteItem[]
  builtin: number
}

interface ItemResult {
  id: string
  pass: boolean
  text?: string
  error?: string
  latencyMs: number
  checks: Array<{ type: string; pass: boolean; detail: string }>
  agentRunId?: number
  agentStatus?: string
}

interface ModelResult {
  model: string
  displayName: string
  platform: string
  passed: number
  total: number
  items: ItemResult[]
}

export interface EvalRun {
  id: number
  suite: string
  models: string[]
  status: 'running' | 'done' | 'error'
  error: string | null
  results: ModelResult[]
  created_at: string
  finished_at: string | null
}

export function EvalsPanel() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [suite, setSuite] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [expanded, setExpanded] = useState<number | null>(null)

  const { runnable } = useRunnableModels()
  const { data: suites = [] } = useQuery<EvalSuite[]>({
    queryKey: ['eval-suites'],
    queryFn: () => apiFetch<{ suites: EvalSuite[] }>('/api/arena/suites').then(r => r.suites),
  })
  const { data: evalsData } = useQuery<{ evals: EvalRun[] }>({
    queryKey: ['evals'],
    queryFn: () => apiFetch('/api/arena/evals?limit=20'),
    refetchInterval: query =>
      query.state.data?.evals.some(e => e.status === 'running') ? 2000 : false,
  })
  const evals = evalsData?.evals ?? []
  const activeSuite = useMemo(() => suites.find(s => s.name === suite) ?? null, [suites, suite])

  const run = useMutation({
    mutationFn: () =>
      apiFetch<EvalRun>('/api/arena/evals', {
        method: 'POST',
        body: JSON.stringify({ suite, models: selected }),
      }),
    onSuccess: evalRun => {
      setExpanded(evalRun.id)
      void queryClient.invalidateQueries({ queryKey: ['evals'] })
      void queryClient.invalidateQueries({ queryKey: ['scorecards'] })
    },
  })

  function toggle(modelId: string) {
    setSelected(prev =>
      prev.includes(modelId)
        ? prev.filter(m => m !== modelId)
        : prev.length >= ARENA_MAX_MODELS ? prev : [...prev, modelId],
    )
  }

  const canRun = suite !== '' && selected.length >= 1 && !run.isPending

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <Card size="sm">
        <CardHeader>
          <CardTitle>{t('arena.tabEvals')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="eval-suite">{t('arena.evals.suite')}</Label>
            <Select value={suite} onValueChange={v => { if (v) setSuite(v) }}>
              <SelectTrigger id="eval-suite">
                <span className="flex flex-1 truncate text-left">
                  {(() => {
                    const s = suites.find(x => x.name === suite)
                    return s ? `${s.name} · ${t('arena.evals.items', { count: s.items.length })}` : t('arena.evals.suite')
                  })()}
                </span>
              </SelectTrigger>
              <SelectContent>
                {suites.map(s => (
                  <SelectItem key={s.name} value={s.name}>
                    {s.name} · {t('arena.evals.items', { count: s.items.length })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {activeSuite?.description && (
              <p className="text-xs text-muted-foreground">{activeSuite.description}</p>
            )}
          </div>
          <fieldset>
            <legend className="mb-1.5 text-xs font-medium">
              {t('arena.modelsLabel', { selected: selected.length, max: ARENA_MAX_MODELS })}
            </legend>
            {runnable.length === 0 && (
              <p className="text-xs text-muted-foreground">{t('arena.noKeyedModels')}</p>
            )}
            <div className="grid max-h-56 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
              {runnable.map(m => {
                const active = selected.includes(m.modelId)
                const capped = !active && selected.length >= ARENA_MAX_MODELS
                return (
                  <button
                    key={m.modelId}
                    type="button"
                    aria-pressed={active}
                    disabled={capped}
                    onClick={() => toggle(m.modelId)}
                    className={`flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left text-xs transition-colors disabled:opacity-40 ${
                      active ? 'border-primary bg-primary/5 font-medium' : 'hover:bg-muted/50'
                    }`}
                  >
                    <span className={`flex size-4 shrink-0 items-center justify-center rounded border ${active ? 'border-primary bg-primary text-primary-foreground' : 'text-transparent'}`} aria-hidden="true">
                      <Check className="size-3" />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{m.displayName}</span>
                  </button>
                )
              })}
            </div>
          </fieldset>
          {run.isError && (
            <p role="alert" className="text-xs text-destructive">{(run.error as Error).message}</p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" disabled={!canRun} onClick={() => run.mutate()}>
              {run.isPending ? <Loader2 className="animate-spin" /> : <FlaskConical />}
              {run.isPending ? t('arena.evals.running') : t('arena.evals.run')}
            </Button>
            {!canRun && !run.isPending && (
              <span className="text-xs text-muted-foreground">{t('arena.evals.selectSuite')}</span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>{t('arena.evals.history')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {evals.length === 0 && (
            <p className="text-xs text-muted-foreground">{t('arena.evals.empty')}</p>
          )}
          {evals.map(evalRun => {
            const open = expanded === evalRun.id
            return (
              <div key={evalRun.id} className="rounded-xl border">
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : evalRun.id)}
                  aria-expanded={open}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
                >
                  <span className="font-mono text-muted-foreground">#{evalRun.id}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{evalRun.suite}</span>
                  {evalRun.status === 'running' ? (
                    <Badge variant="default" className="shrink-0">
                      <Loader2 className="size-3 animate-spin" /> {t('arena.evals.running')}
                    </Badge>
                  ) : (
                    <Badge variant={evalRun.status === 'done' ? 'secondary' : 'destructive'} className="shrink-0">
                      {evalRun.status === 'done'
                        ? t('arena.evals.passed', {
                            passed: evalRun.results.reduce((n, r) => n + r.passed, 0),
                            total: evalRun.results.reduce((n, r) => n + r.total, 0),
                          })
                        : evalRun.error ?? t('arena.failed')}
                    </Badge>
                  )}
                  <ChevronDown className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
                </button>
                {open && (
                  <div className="flex flex-col gap-2 border-t px-3 py-2">
                    {evalRun.results.map(result => (
                      <div key={result.model} className="rounded-lg bg-muted/50 px-2.5 py-2">
                        <p className="flex items-center gap-2 text-xs font-medium">
                          <span className="min-w-0 flex-1 truncate">{result.displayName}</span>
                          <span className="shrink-0 font-mono text-[11px] tabular-nums">
                            {result.passed}/{result.total}
                          </span>
                        </p>
                        <div className="mt-1.5 flex flex-col gap-1">
                          {result.items.map(item => (
                            <p key={item.id} className="flex items-start gap-1.5 text-[11px]">
                              {item.pass
                                ? <Check className="mt-0.5 size-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
                                : <X className="mt-0.5 size-3 shrink-0 text-destructive" />}
                              <span className="min-w-0 flex-1">
                                <span className="font-mono">{item.id}</span>
                                {item.agentRunId != null && (
                                  <Link
                                    className="ml-1.5 font-mono text-primary underline-offset-2 hover:underline"
                                    to={`/agents?tab=runs&run=${item.agentRunId}`}
                                  >
                                    {t('arena.evals.agentRun', { id: item.agentRunId })}
                                  </Link>
                                )}
                                {item.error && <span className="text-destructive"> — {item.error}</span>}
                                {!item.error && item.checks.length > 0 && (
                                  <span className="text-muted-foreground">
                                    {' — '}{item.checks.map(c => c.detail).join('; ')}
                                  </span>
                                )}
                              </span>
                              <span className="shrink-0 font-mono text-muted-foreground tabular-nums">
                                {item.latencyMs} ms
                              </span>
                            </p>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}
