import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { useI18n } from '@/i18n'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

interface ProxySettings {
  proxyUrl: string
  proxyMode: 'forward' | 'fetch-relay'
  fetchRelayTokenConfigured: boolean
  enabled: boolean
  bypassPlatforms: string[]
  active: boolean
}

function useProxySettings() {
  return useQuery<ProxySettings>({
    queryKey: ['settings', 'proxy'],
    queryFn: () => apiFetch('/api/settings/proxy'),
  })
}

function useSaveProxySettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<ProxySettings> & { fetchRelayToken?: string }) =>
      apiFetch<ProxySettings>('/api/settings/proxy', { method: 'PUT', body: JSON.stringify(patch) }),
    onSuccess: data => queryClient.setQueryData(['settings', 'proxy'], data),
  })
}

export function EgressSection() {
  const { t } = useI18n()
  const { data: proxy } = useProxySettings()
  const save = useSaveProxySettings()
  const [form, setForm] = useState({ url: '', bypass: '', forUrl: '', forBypass: '' })
  const [token, setToken] = useState('')
  const { url, bypass } = form

  // Sync the form when fresh proxy data arrives (render-time state
  // adjustment, not an effect: the query result is the source of truth).
  if (proxy && (form.forUrl !== proxy.proxyUrl || form.forBypass !== proxy.bypassPlatforms.join(','))) {
    setForm({
      url: proxy.proxyUrl,
      bypass: proxy.bypassPlatforms.join(', '),
      forUrl: proxy.proxyUrl,
      forBypass: proxy.bypassPlatforms.join(','),
    })
  }
  const setUrl = (next: string) => setForm(current => ({ ...current, url: next }))
  const setBypass = (next: string) => setForm(current => ({ ...current, bypass: next }))

  function saveForm() {
    save.mutate(
      {
        proxyUrl: url.trim(),
        proxyMode: proxy?.proxyMode ?? 'forward',
        // The API clears the saved token on an explicit empty string, so
        // only send it when the operator typed a new one.
        ...(token ? { fetchRelayToken: token } : {}),
        bypassPlatforms: bypass.split(',').map(s => s.trim()).filter(Boolean),
      },
      {
        onSuccess: () => {
          setToken('')
          toast.success(t('settings.saved'))
        },
        onError: err => toast.error(err instanceof Error ? err.message : t('common.unknownError')),
      },
    )
  }

  return (
    <>
      <div className="mb-5 space-y-1.5">
        <h2 className="font-heading text-base leading-snug font-medium">{t('settings.sectionEgress')}</h2>
        <p className="text-xs leading-relaxed text-muted-foreground">{t('settings.egressDescription')}</p>
      </div>

      <div className="grid gap-4">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="egress-enabled">{t('settings.egressEnabled')}</Label>
          <Switch
            id="egress-enabled"
            checked={proxy?.enabled ?? false}
            onCheckedChange={checked => save.mutate({ enabled: checked })}
          />
        </div>

        <p className="text-xs text-muted-foreground" role="status">
          {proxy?.active ? t('settings.egressActive') : t('settings.egressDirect')}
        </p>

        <div className="grid gap-1.5">
          <Label htmlFor="egress-url">{t('settings.egressUrl')}</Label>
          <Input
            id="egress-url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder={t('settings.egressUrlPlaceholder')}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="egress-mode">{t('settings.egressMode')}</Label>
          <select
            id="egress-mode"
            value={proxy?.proxyMode ?? 'forward'}
            onChange={e => save.mutate({ proxyMode: e.target.value as ProxySettings['proxyMode'] })}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-xs"
          >
            <option value="forward">{t('settings.egressModeForward')}</option>
            <option value="fetch-relay">{t('settings.egressModeRelay')}</option>
          </select>
        </div>

        {proxy?.proxyMode === 'fetch-relay' && (
          <div className="grid gap-1.5">
            <Label htmlFor="egress-token">{t('settings.egressToken')}</Label>
            <Input
              id="egress-token"
              type="password"
              value={token}
              onChange={e => setToken(e.target.value)}
              placeholder={
                proxy.fetchRelayTokenConfigured
                  ? t('settings.egressTokenSaved')
                  : t('settings.egressTokenPlaceholder')
              }
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        )}

        <div className="grid gap-1.5">
          <Label htmlFor="egress-bypass">{t('settings.egressBypass')}</Label>
          <Input
            id="egress-bypass"
            value={bypass}
            onChange={e => setBypass(e.target.value)}
            placeholder={t('settings.egressBypassPlaceholder')}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div>
          <Button size="sm" disabled={save.isPending} onClick={saveForm}>
            {save.isPending ? t('common.saving') : t('common.saveChanges')}
          </Button>
        </div>
      </div>
    </>
  )
}
