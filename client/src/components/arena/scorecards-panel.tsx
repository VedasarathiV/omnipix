import { useQuery } from '@tanstack/react-query'
import { Trophy } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useI18n } from '@/i18n'

export interface Scorecard {
  model: string
  displayName: string
  platform: string
  runs: number
  passed: number
  total: number
  passRate: number
  suites: Record<string, { runs: number; passed: number; total: number }>
  lastRunAt: string
}

function barColor(rate: number): string {
  if (rate >= 0.9) return 'bg-emerald-500'
  if (rate >= 0.7) return 'bg-primary'
  if (rate >= 0.4) return 'bg-amber-500'
  return 'bg-destructive'
}

export function ScorecardsPanel() {
  const { t } = useI18n()
  const { data: cards = [], isLoading } = useQuery<Scorecard[]>({
    queryKey: ['scorecards'],
    queryFn: () => apiFetch<{ scorecards: Scorecard[] }>('/api/arena/scorecards').then(r => r.scorecards),
  })

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{t('arena.tabScorecards')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {isLoading && <p className="text-xs text-muted-foreground">…</p>}
        {!isLoading && cards.length === 0 && (
          <p className="text-xs text-muted-foreground">{t('arena.scorecards.empty')}</p>
        )}
        {cards.map((card, i) => (
          <div key={card.model} className="rounded-xl border px-3 py-2.5">
            <p className="flex items-center gap-2 text-xs">
              {i === 0 && <Trophy className="size-3.5 text-amber-500" aria-label="top" />}
              <span className="min-w-0 flex-1 truncate font-medium">{card.displayName}</span>
              <Badge variant="outline" className="shrink-0 font-mono text-[10px]">{card.platform}</Badge>
              <span className="shrink-0 font-mono text-[11px] tabular-nums">
                {(card.passRate * 100).toFixed(1)}% {t('arena.scorecards.passRate')}
              </span>
            </p>
            <div
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={Math.round(card.passRate * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${card.displayName} ${t('arena.scorecards.passRate')}`}
            >
              <div className={`h-full rounded-full ${barColor(card.passRate)}`} style={{ width: `${card.passRate * 100}%` }} />
            </div>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span>{card.runs} {t('arena.scorecards.runs')}</span>
              <span className="font-mono tabular-nums">{card.passed}/{card.total}</span>
              <span>{t('arena.scorecards.lastRun')}: {new Date(card.lastRunAt).toLocaleString()}</span>
            </p>
            {Object.keys(card.suites).length > 0 && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t('arena.scorecards.perSuite')}: {Object.entries(card.suites)
                  .map(([name, s]) => `${name} ${s.passed}/${s.total}`)
                  .join(' · ')}
              </p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
