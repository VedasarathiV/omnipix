import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/i18n'
import { apiFetch } from '@/lib/api'
import { Tooltip } from '@/components/tooltip'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface CacheStats {
  enabled: boolean
  semanticThreshold: number
}

// Semantic-cache threshold control. The master cache switch lives outside the
// dashboard (env var); this tunes the near-duplicate tier, which only acts on
// requests the cache already serves.
export function SemanticCacheControl() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const { data } = useQuery<CacheStats>({
    queryKey: ['cache', 'stats'],
    queryFn: () => apiFetch('/api/cache/stats'),
  })
  const [value, setValue] = useState('')

  // Sync server state into the editable draft; the field-level dep resyncs
  // only when the threshold actually changes, not on every query refetch.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (data) setValue(String(data.semanticThreshold ?? 0))
  }, [data?.semanticThreshold]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: () =>
      apiFetch('/api/cache/config', {
        method: 'PUT',
        // Threshold only — `enabled` stays untouched so this control never
        // flips the master switch as a side effect.
        body: JSON.stringify({ semanticThreshold: Number(value) }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cache', 'stats'] }),
  })

  const parsed = Number(value)
  const valid = value.trim() !== '' && Number.isFinite(parsed) && parsed >= 0 && parsed <= 1

  return (
    <div className="flex flex-col gap-2 rounded-2xl border p-3">
      <p className="inline-flex items-center gap-2 text-xs font-medium">
        <span>{t('strategies.semanticCacheTitle')}</span>
        <Tooltip text={t('strategies.semanticCacheHint')}>
          <span className="cursor-help font-normal text-muted-foreground underline decoration-dotted underline-offset-2">?</span>
        </Tooltip>
      </p>
      <div className="flex items-end gap-2">
        <div className="grid gap-1">
          <Label htmlFor="semantic-cache-threshold" className="text-[11px]">{t('strategies.semanticCacheThreshold')}</Label>
          <Input
            id="semantic-cache-threshold"
            inputMode="decimal"
            value={value}
            onChange={e => setValue(e.target.value)}
            className="h-8 w-24 font-mono text-xs"
            aria-invalid={!valid}
          />
        </div>
        <Button size="sm" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
          {t('strategies.semanticCacheSave')}
        </Button>
        {data && data.semanticThreshold === 0 && (
          <span className="pb-1.5 text-[11px] text-muted-foreground">{t('strategies.semanticCacheOff')}</span>
        )}
      </div>
      {save.isError && (
        <span role="alert" className="text-[11px] text-destructive">{(save.error as Error).message}</span>
      )}
    </div>
  )
}
