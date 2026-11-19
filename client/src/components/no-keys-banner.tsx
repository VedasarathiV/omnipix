import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { KeyRound } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/button'

interface ModelRow {
  enabled: boolean
  keyCount?: number
}

/**
 * Global first-run guidance: when no keyed model exists anywhere, nothing in
 * the app can run — chat fails, runs error, evals sit empty. One slim banner
 * above every page says so and routes to Keys, instead of letting each
 * surface fail in its own confusing way. Hidden on /keys itself and until
 * the models query resolves (no flash for configured installs).
 */
export function NoKeysBanner() {
  const { t } = useI18n()
  const location = useLocation()
  const navigate = useNavigate()
  const { data: models } = useQuery<ModelRow[]>({
    queryKey: ['models'],
    queryFn: () => apiFetch('/api/models'),
    staleTime: 30_000,
  })

  if (location.pathname === '/keys' || !models) return null
  const keyed = models.some(m => m.enabled && (m.keyCount ?? 0) > 0)
  if (keyed) return null

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-center">
      <span className="inline-flex items-center gap-1.5 text-xs text-amber-800 dark:text-amber-200">
        <KeyRound className="size-3.5" aria-hidden="true" />
        {t('setup.noKeysBanner')}
      </span>
      <Button variant="outline" size="xs" onClick={() => navigate('/keys')}>
        {t('setup.noKeysCta')}
      </Button>
    </div>
  )
}
