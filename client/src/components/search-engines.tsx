import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { CardSkeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/page-header'
import { ModelsTabs } from '@/components/models-tabs'
import { UsageSummaryCard } from '@/components/usage-summary-card'
import { useI18n } from '@/i18n'
import { engineChain, freeFromDate, invalidateSearchQueries, type SearchAnalytics, type SearchEngine } from '@/lib/search'
import { useSearchReadiness } from '@/hooks/use-search-readiness'
import { SearchReadinessNotice } from './search-readiness-notice'

const pill = 'text-[10px] rounded-full px-1.5 py-0.5 bg-muted text-muted-foreground'

// One engine from the catalog's `searchEngines` section. Its position in the
// failover order is shown as a number; the first enabled engine is the
// default, and any other can be promoted to it in one click.
function SearchEngineCard({
  engine: e,
  position,
  isDefault,
  onToggle,
  onMakeDefault,
  pending,
}: {
  engine: SearchEngine
  position: number | null
  isDefault: boolean
  onToggle: (enabled: boolean) => void
  onMakeDefault: () => void
  pending: boolean
}) {
  const { t, locale } = useI18n()
  const queryClient = useQueryClient()
  const test = useMutation({
    mutationFn: () => apiFetch(`/api/search/engines/${e.id}/test`, {
      method: 'POST', body: JSON.stringify({ query: 'OpenAI' }),
    }),
    onSettled: () => invalidateSearchQueries(queryClient),
  })
  const freeFrom = freeFromDate(e.premiumSince)
  const features = e.features ?? {}
  return (
    <section className={`rounded-3xl border bg-card p-5 ${e.enabled ? '' : 'opacity-60'}`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-medium">{e.engineId}</span>
        {e.creditsPerQuery != null && (
          <span className={`${pill} tabular-nums`}>
            {e.creditsPerQuery === 1
              ? t('search.creditsPerSearchOne')
              : t('search.creditsPerSearchOther', { count: e.creditsPerQuery })}
          </span>
        )}
        {freeFrom && (
          <span className="text-[10px] rounded-full px-1.5 py-0.5 bg-amber-600/15 text-amber-700 dark:bg-amber-400/15 dark:text-amber-400">
            {t('search.premiumBadge', {
              date: freeFrom.toLocaleDateString(locale, { day: 'numeric', month: 'short' }),
            })}
          </span>
        )}
        {features.news && <span className={pill}>{t('search.featureNews')}</span>}
        {features.answer && <span className={pill}>{t('search.featureAnswer')}</span>}
        {features.fullContent && <span className={pill}>{t('search.featureFullContent')}</span>}
        {isDefault ? (
          <span className="text-xs text-muted-foreground">{t('search.default')}</span>
        ) : e.enabled && (
          <button
            type="button"
            onClick={onMakeDefault}
            disabled={pending}
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
          >
            {t('search.makeDefault')}
          </button>
        )}
        <span className="flex-1" />
        <span className="text-xs text-muted-foreground tabular-nums">
          {t('search.thisMonth', { count: e.searchesThisMonth })}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <span className="w-4 text-center text-xs text-muted-foreground tabular-nums">{position ?? '–'}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{e.displayName}</span>
            {e.keyCount === 0 && (
              <span className="text-[10px] rounded-full px-1.5 py-0.5 bg-amber-600/15 text-amber-700 dark:bg-amber-400/15 dark:text-amber-400">
                {t('models.noKey')}
              </span>
            )}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {[e.platform, e.quotaLabel].filter(Boolean).join(' · ')}
          </div>
        </div>
        <Switch
          checked={e.enabled}
          onCheckedChange={onToggle}
          disabled={pending}
          aria-label={e.displayName}
        />
        <button type="button" className="text-xs underline disabled:opacity-50"
          onClick={() => test.mutate()} disabled={!e.enabled || e.keyCount === 0 || test.isPending}>
          {test.isPending ? t('common.loading') : t('keys.testModel')}
        </button>
      </div>
      {test.isSuccess && <p role="status" className="mt-2 text-xs">{t('common.success')}</p>}
      {test.isError && <p role="alert" className="mt-2 text-xs text-destructive">{test.error.message}</p>}
    </section>
  )
}

interface SearchConsoleHit {
  title: string
  url: string
  content: string
  score: number
}

interface SearchConsoleResponse {
  query: string
  answer?: string
  results: SearchConsoleHit[]
  provider: string
  engine: string
}

// The query console above the engine list: type a question, read the answer
// and the ranked hits. It calls POST /v1/search with the install's unified
// key, exactly like an external client would — so what you see here is what
// the API returns.
function SearchConsole() {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const { data: keyData } = useQuery<{ apiKey: string }>({
    queryKey: ['unified-key'],
    queryFn: () => apiFetch('/api/settings/api-key'),
  })
  const search = useMutation({
    mutationFn: async (q: string) => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (keyData?.apiKey) headers['Authorization'] = `Bearer ${keyData.apiKey}`
      const base = import.meta.env.BASE_URL.replace(/\/$/, '')
      const res = await fetch(`${base}/v1/search`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: q, max_results: 8, include_answer: true }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: { message?: string } } | null
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`)
      }
      return res.json() as Promise<SearchConsoleResponse>
    },
  })

  return (
    <section className="rounded-3xl border bg-card p-5" data-testid="search-console">
      <form
        className="flex gap-2"
        onSubmit={e => {
          e.preventDefault()
          const q = query.trim()
          if (q && !search.isPending) search.mutate(q)
        }}
      >
        <Input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('search.consolePlaceholder')}
          aria-label={t('search.consoleSearch')}
          className="h-9 text-sm"
          disabled={search.isPending}
        />
        <Button type="submit" size="sm" className="h-9" disabled={search.isPending || query.trim().length === 0}>
          {search.isPending ? t('search.consoleSearching') : t('search.consoleSearch')}
        </Button>
      </form>
      {search.isError && (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {search.error instanceof Error ? search.error.message : String(search.error)}
        </p>
      )}
      {search.isSuccess && (
        <div className="mt-4 space-y-3">
          {search.data.answer && (
            <div className="rounded-xl bg-muted/50 p-3 text-xs leading-relaxed">
              <p className="mb-1 font-medium">{t('search.consoleAnswer')}</p>
              <p className="whitespace-pre-wrap">{search.data.answer}</p>
            </div>
          )}
          {search.data.results.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('search.consoleEmpty')}</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {t('search.consoleResults', { count: search.data.results.length })}
                {' · '}{t('search.consoleVia', { provider: search.data.provider, engine: search.data.engine })}
              </p>
              <ol className="space-y-2">
                {search.data.results.map((hit, i) => (
                  <li key={`${hit.url}-${i}`} className="rounded-xl border p-3">
                    <a
                      href={hit.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                    >
                      {hit.title || hit.url}
                    </a>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{hit.url}</p>
                    {hit.content && (
                      <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">{hit.content}</p>
                    )}
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      )}
    </section>
  )
}

// Models → Search: the catalog's search engines in failover order, with the
// same month-to-date usage card the media tabs use. Rows sync from the signed
// catalog like every other modality; the toggles and "Make default" are the
// operator's local overrides.
export function SearchEnginesView() {
  const { t } = useI18n()
  const queryClient = useQueryClient()

  const readiness = useSearchReadiness()
  const engines = readiness.engines
  const isLoading = readiness.loading

  // Only `today` is read here; the month total is the sum of the engine rows.
  const { data: analytics } = useQuery<SearchAnalytics>({
    queryKey: ['analytics', 'search', '30d'],
    queryFn: () => apiFetch('/api/analytics/search?range=30d'),
    refetchInterval: 30_000,
  })

  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: number; enabled?: boolean; priority?: number }) =>
      apiFetch(`/api/search/engines/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => invalidateSearchQueries(queryClient),
  })

  const ordered = engines
    .slice()
    .sort((a, b) => a.priority - b.priority || a.displayName.localeCompare(b.displayName))
  const chain = engineChain(engines)
  const positions = new Map(chain.map((e, i) => [e.id, i + 1]))
  const total = engines.reduce((n, e) => n + e.searchesThisMonth, 0)

  return (
    <div>
      <PageHeader title={t('models.title')} description={t('search.pageDesc')} divider={false} actions={<ModelsTabs />} />

      <div className="space-y-4">
        <SearchConsole />
        <p className="text-xs text-muted-foreground">
          {t('search.endpointHint')}{' '}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">POST /v1/search</code>{' '}
          {t('search.agentsHint')}
        </p>

        {engines.length > 0 && (
          <UsageSummaryCard
            unit="requests"
            total={total}
            requestsToday={analytics?.today ?? 0}
            rows={ordered.map(e => ({
              label: e.displayName,
              platform: e.platform,
              quotaLabel: e.quotaLabel,
              amount: e.searchesThisMonth,
              requestsToday: 0,
            }))}
          />
        )}

        <SearchReadinessNotice {...readiness} onRetry={readiness.retry} />
        {isLoading ? (
          <>
            <CardSkeleton />
            <CardSkeleton />
          </>
        ) : readiness.failed || ordered.length === 0 ? null : (
          ordered.map(e => (
            <SearchEngineCard
              key={e.id}
              engine={e}
              position={positions.get(e.id) ?? null}
              isDefault={chain[0]?.id === e.id}
              onToggle={enabled => update.mutate({ id: e.id, enabled })}
              onMakeDefault={() => update.mutate({ id: e.id, priority: 0 })}
              pending={update.isPending}
            />
          ))
        )}
      </div>
    </div>
  )
}
