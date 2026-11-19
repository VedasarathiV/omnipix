import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/i18n'
import { apiFetch } from '@/lib/api'
import { Tooltip } from '@/components/tooltip'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'

interface ContentGuardState {
  inbound: 'off' | 'redact' | 'block'
  outbound: 'off' | 'redact'
  blockedPatterns: string[]
  stats: { inboundRedactions: number; inboundBlocks: number; outboundRedactions: number }
}

// Gateway-side content guardrails: PII redaction + a prompt blocklist applied
// inside the gateway, so they hold for every provider behind it. Owns its own
// query + mutation like the other settings-backed controls on this page.
export function ContentGuardControl() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const { data } = useQuery<ContentGuardState>({
    queryKey: ['settings', 'content-guard'],
    queryFn: () => apiFetch('/api/settings/content-guard'),
  })
  const [patterns, setPatterns] = useState('')
  const [savedTick, setSavedTick] = useState(0)

  // Sync server state into the editable draft; the joined-string dep resyncs
  // only when the patterns actually change, not on every query refetch.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (data) setPatterns(data.blockedPatterns.join('\n'))
  }, [data?.blockedPatterns.join('\n')]) // eslint-disable-line react-hooks/exhaustive-deps

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['settings', 'content-guard'] })
  }

  const saveModes = useMutation({
    mutationFn: (body: { inbound?: string; outbound?: string }) =>
      apiFetch('/api/settings/content-guard', { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: invalidate,
  })

  const savePatterns = useMutation({
    mutationFn: () =>
      apiFetch('/api/settings/content-guard', {
        method: 'PUT',
        body: JSON.stringify({
          blockedPatterns: patterns.split('\n').map(l => l.trim()).filter(Boolean),
        }),
      }),
    onSuccess: () => {
      setSavedTick(n => n + 1)
      invalidate()
    },
  })

  return (
    <div className="flex flex-col gap-2 rounded-2xl border p-3">
      <p className="inline-flex items-center gap-2 text-xs font-medium">
        <span>{t('strategies.contentGuardTitle')}</span>
        <Tooltip text={t('strategies.contentGuardHint')}>
          <span className="cursor-help font-normal text-muted-foreground underline decoration-dotted underline-offset-2">?</span>
        </Tooltip>
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1">
          <Label htmlFor="content-guard-inbound" className="text-[11px]">{t('strategies.contentGuardInbound')}</Label>
          <Select
            value={data?.inbound ?? 'off'}
            onValueChange={v => { if (v) saveModes.mutate({ inbound: v }) }}
            disabled={saveModes.isPending}
          >
            <SelectTrigger id="content-guard-inbound" className="h-8 w-36 text-xs">
              <span className="flex flex-1 truncate text-left">
                {data?.inbound === 'redact' ? t('strategies.contentGuardRedact') : data?.inbound === 'block' ? t('strategies.contentGuardBlock') : t('strategies.contentGuardOff')}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">{t('strategies.contentGuardOff')}</SelectItem>
              <SelectItem value="redact">{t('strategies.contentGuardRedact')}</SelectItem>
              <SelectItem value="block">{t('strategies.contentGuardBlock')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="content-guard-outbound" className="text-[11px]">{t('strategies.contentGuardOutbound')}</Label>
          <Select
            value={data?.outbound ?? 'off'}
            onValueChange={v => { if (v) saveModes.mutate({ outbound: v }) }}
            disabled={saveModes.isPending}
          >
            <SelectTrigger id="content-guard-outbound" className="h-8 w-36 text-xs">
              <span className="flex flex-1 truncate text-left">
                {data?.outbound === 'redact' ? t('strategies.contentGuardRedact') : t('strategies.contentGuardOff')}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">{t('strategies.contentGuardOff')}</SelectItem>
              <SelectItem value="redact">{t('strategies.contentGuardRedact')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="content-guard-patterns" className="text-[11px]">{t('strategies.contentGuardPatterns')}</Label>
        <Textarea
          id="content-guard-patterns"
          value={patterns}
          onChange={e => setPatterns(e.target.value)}
          placeholder={t('strategies.contentGuardPatternsPlaceholder')}
          rows={2}
          className="font-mono text-xs"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={savePatterns.isPending} onClick={() => savePatterns.mutate()}>
          {t('strategies.contentGuardSave')}
        </Button>
        {savedTick > 0 && !savePatterns.isError && (
          <span className="text-[11px] text-muted-foreground">{t('strategies.contentGuardSaved')}</span>
        )}
        {savePatterns.isError && (
          <span role="alert" className="text-[11px] text-destructive">{(savePatterns.error as Error).message}</span>
        )}
      </div>
      {data && (
        <p className="text-[11px] text-muted-foreground">
          {t('strategies.contentGuardStats', {
            blocks: data.stats.inboundBlocks,
            inbound: data.stats.inboundRedactions,
            outbound: data.stats.outboundRedactions,
          })}
        </p>
      )}
    </div>
  )
}
