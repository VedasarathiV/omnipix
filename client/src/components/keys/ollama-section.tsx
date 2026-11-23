import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Cpu } from 'lucide-react'
import { useI18n } from '@/i18n'

// Local Ollama, the keyless path: users who can't (or won't) buy API keys run
// models on their own laptop. The daemon is probed on loopback only; Connect
// registers its chat models as a keyless custom endpoint, and Pull fetches
// weights by name. No keys, no account, no cloud.
interface OllamaLocalModel {
  name: string
  size: number | null
}

interface OllamaStatus {
  running: boolean
  version: string | null
  models: OllamaLocalModel[]
  connected: boolean
  registeredModels: string[]
}

function formatModelBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

export function OllamaSection() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [model, setModel] = useState('')
  const { data, isLoading } = useQuery<{ ollama: OllamaStatus }>({
    queryKey: ['local-ollama'],
    queryFn: () => apiFetch('/api/local/ollama'),
  })
  // Connect/pull change the key + model inventory, so everything refreshes.
  const refresh = () => queryClient.invalidateQueries()
  const connect = useMutation({
    mutationFn: () => apiFetch<{ models: string[] }>('/api/local/ollama/connect', { method: 'POST' }),
    onSuccess: res => {
      toast.success(t('keys.ollamaConnected', { count: res.models.length }))
      refresh()
    },
    onError: err => toast.error(err instanceof Error ? err.message : String(err)),
    onSettled: refresh,
  })
  const pull = useMutation({
    mutationFn: (name: string) =>
      apiFetch('/api/local/ollama/pull', { method: 'POST', body: JSON.stringify({ model: name }) }),
    onSuccess: () => {
      setModel('')
      refresh()
    },
    onError: err => toast.error(err instanceof Error ? err.message : String(err)),
    onSettled: refresh,
  })

  const status = data?.ollama
  const models = Array.isArray(status?.models) ? status.models : []
  const busy = connect.isPending || pull.isPending

  return (
    <section className="rounded-3xl border bg-card p-5" data-testid="ollama-section">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <Cpu className="size-3.5 text-muted-foreground" />
          {t('keys.ollamaTitle')}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">{t('keys.ollamaDescription')}</p>
      </div>
      <div className="mt-4 space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span
            className={`inline-block size-2 rounded-full ${status?.running ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`}
            aria-hidden="true"
          />
          {isLoading || !status ? (
            <span className="text-muted-foreground">{t('keys.ollamaChecking')}</span>
          ) : status.running ? (
            <span>
              {t('keys.ollamaRunning', { version: status.version ?? '?' })}
              {status.connected && (
                <span className="text-muted-foreground">
                  {' · '}{t('keys.ollamaConnected', { count: status.registeredModels.length })}
                </span>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground">{t('keys.ollamaNotRunning')}</span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => connect.mutate()}
            disabled={busy || !status?.running}
            title={t('keys.ollamaConnectHint')}
          >
            {connect.isPending ? t('keys.ollamaConnecting') : t('keys.ollamaConnect')}
          </Button>
        </div>
        {status?.running && (
          models.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('keys.ollamaNoModels')}</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {models.map(m => (
                <li key={m.name} className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-1.5">
                  <span className="truncate font-mono">{m.name}</span>
                  {typeof m.size === 'number' && (
                    <span className="shrink-0 tabular-nums text-muted-foreground">{formatModelBytes(m.size)}</span>
                  )}
                </li>
              ))}
            </ul>
          )
        )}
        <form
          className="flex gap-2"
          onSubmit={e => {
            e.preventDefault()
            const name = model.trim()
            if (name && !busy) pull.mutate(name)
          }}
        >
          <Input
            value={model}
            onChange={e => setModel(e.target.value)}
            placeholder={t('keys.ollamaPullPlaceholder')}
            aria-label={t('keys.ollamaPull')}
            className="h-8 text-xs"
            disabled={busy || !status?.running}
          />
          <Button type="submit" variant="outline" size="sm" disabled={busy || !status?.running || model.trim().length === 0}>
            {pull.isPending ? t('keys.ollamaPulling') : t('keys.ollamaPull')}
          </Button>
        </form>
      </div>
    </section>
  )
}
