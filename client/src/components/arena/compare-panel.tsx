import { useMemo, useState, type CSSProperties } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Check, FlaskConical, Loader2, Swords } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Markdown } from '@/components/markdown'
import { CardSkeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/i18n'
import { useRunnableModels } from './use-runnable-models'

interface ArenaResult {
  model: string
  displayName: string
  platform: string
  ok: boolean
  text?: string
  error?: string
  latencyMs: number
  promptTokens?: number
  completionTokens?: number
}

export const ARENA_MAX_MODELS = 6

export function ComparePanel() {
  const { t } = useI18n()
  const [prompt, setPrompt] = useState('')
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<string[]>([])

  const { runnable, isLoading, isError: modelsError, error: modelsFailure } = useRunnableModels()

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return runnable
    return runnable.filter(m =>
      `${m.displayName} ${m.modelId} ${m.platform}`.toLowerCase().includes(q),
    )
  }, [runnable, filter])

  function toggle(modelId: string) {
    setSelected(prev =>
      prev.includes(modelId)
        ? prev.filter(m => m !== modelId)
        : prev.length >= ARENA_MAX_MODELS ? prev : [...prev, modelId],
    )
  }

  const run = useMutation({
    mutationFn: (body: { models: string[]; messages: { role: string; content: string }[] }) =>
      apiFetch<{ execution_id: string; results: ArenaResult[] }>('/api/arena/run', {
        method: 'POST',
        body: JSON.stringify({ ...body, max_tokens: 1024 }),
      }),
  })

  const canRun = selected.length >= 2 && prompt.trim().length > 0 && !run.isPending
  const results = run.data?.results ?? []

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border bg-card p-5">
        <label className="text-sm font-medium" htmlFor="arena-prompt">
          {t('arena.promptLabel')}
        </label>
        <Textarea
          id="arena-prompt"
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder={t('arena.promptPlaceholder')}
          className="mt-2 min-h-24"
        />

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium">
            {t('arena.modelsLabel', { selected: selected.length, max: ARENA_MAX_MODELS })}
          </h2>
          <Input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder={t('arena.searchPlaceholder')}
            className="h-8 w-52"
            aria-label={t('arena.searchPlaceholder')}
          />
        </div>
        {modelsError ? (
          <p role="alert" className="mt-3 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {t('arena.loadFailed')}{' '}
            {modelsFailure instanceof Error ? modelsFailure.message : ''}
          </p>
        ) : isLoading ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map(i => <CardSkeleton key={i} />)}
          </div>
        ) : runnable.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t('arena.noKeyedModels')}</p>
        ) : (
          <div className="mt-3 grid max-h-64 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3" role="group" aria-label={t('arena.modelsLabel', { selected: selected.length, max: ARENA_MAX_MODELS })}>
            {visible.map(m => {
              const active = selected.includes(m.modelId)
              const capped = !active && selected.length >= ARENA_MAX_MODELS
              return (
                <button
                  key={m.modelId}
                  type="button"
                  aria-pressed={active}
                  disabled={capped}
                  onClick={() => toggle(m.modelId)}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs transition-colors disabled:opacity-40 ${
                    active
                      ? 'border-primary bg-primary/5 font-medium'
                      : 'hover:border-muted-foreground/40 hover:bg-muted/50'
                  }`}
                >
                  <span className={`flex size-4 shrink-0 items-center justify-center rounded border ${active ? 'border-primary bg-primary text-primary-foreground' : 'text-transparent'}`} aria-hidden="true">
                    <Check className="size-3" />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{m.displayName}</span>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{m.platform}</span>
                </button>
              )
            })}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            disabled={!canRun}
            onClick={() => run.mutate({ models: selected, messages: [{ role: 'user', content: prompt.trim() }] })}
          >
            {run.isPending ? <Loader2 className="animate-spin" /> : <Swords />}
            {run.isPending ? t('arena.running') : t('arena.run')}
          </Button>
          {selected.length < 2 && (
            <span className="text-xs text-muted-foreground">{t('arena.selectAtLeastTwo')}</span>
          )}
          {run.isError && (
            <span role="alert" className="text-xs text-destructive">{(run.error as Error).message}</span>
          )}
        </div>
      </section>

      {results.length > 0 && (
        <div className="grid items-start gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {results.map((r, i) => (
            <Card
              key={r.model}
              size="sm"
              className="ox-enter"
              style={{ '--ox-i': Math.min(i, 5) } as CSSProperties}
            >
              <div className="flex flex-wrap items-center gap-2 px-1">
                <FlaskConical className="size-3.5 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.displayName}</span>
                <Badge variant="outline" className="font-mono text-[10px]">{r.platform}</Badge>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 font-mono text-[11px] text-muted-foreground tabular-nums">
                <span>{t('arena.latency', { ms: r.latencyMs })}</span>
                {r.ok && r.promptTokens !== undefined && r.completionTokens !== undefined && (
                  <span>{t('arena.tokens', { prompt: r.promptTokens, completion: r.completionTokens })}</span>
                )}
                {!r.ok && <span className="font-sans text-destructive">{t('arena.failed')}</span>}
              </div>
              <div className="rounded-2xl border bg-muted/30 p-4">
                {r.ok ? (
                  <Markdown>{r.text ?? ''}</Markdown>
                ) : (
                  <p className="text-sm text-destructive">{r.error ?? t('arena.failed')}</p>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
