import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { invalidateSearchQueries } from '@/lib/search'
import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { PageHeader } from '@/components/page-header'
import type { ApiKey, Platform } from '../../../shared/types'
import { Plus, Download } from 'lucide-react'
import { useI18n } from '@/i18n'
import { LISTED_PLATFORMS, type HealthData } from '@/components/keys/shared'
import { KEYS_TABS, type KeysTab } from '@/lib/keys-tabs'
import { QuotaSignalsSection } from '@/components/keys/quota-signals-section'
import { UnifiedKeySection } from '@/components/keys/unified-key-section'
import { ClientProfilesSection } from '@/components/keys/client-profiles-section'
import { ProxySettingsSection } from '@/components/keys/proxy-settings-section'
import { BackupsSection } from '@/components/keys/backups-section'
import { AnthropicSection } from '@/components/keys/anthropic-section'
import { ProviderList } from '@/components/keys/provider-list'
import { ProviderChecklistSection } from '@/components/keys/provider-checklist-section'
import { AddKeyDialog } from '@/components/keys/add-key-dialog'
import { ExportKeysDialog } from '@/components/keys/export-keys-dialog'
import { AgentCompatibilitySection } from '@/components/keys/agent-compatibility-section'

export default function KeysPage() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  // `/keys?tab=<id>` deep-links a tab (the workbench sidebar); the tab is
  // derived from the URL, never mirrored state, so sidebar and page agree.
  // Unknown values fall back to providers, and the bogus param is replaced
  // so the URL never names a tab that does not exist.
  const rawTab = searchParams.get('tab')
  const tab: KeysTab = KEYS_TABS.some(tb => tb.id === rawTab)
    ? (rawTab as KeysTab)
    : 'providers'
  useEffect(() => {
    if (rawTab !== null && !KEYS_TABS.some(tb => tb.id === rawTab)) {
      setSearchParams(prev => { prev.delete('tab'); return prev }, { replace: true })
    }
  }, [rawTab, setSearchParams])
  const setTab = (next: KeysTab) => {
    // Bare /keys is the canonical providers URL (matches the sidebar link).
    setSearchParams(prev => {
      if (next === 'providers') prev.delete('tab')
      else prev.set('tab', next)
      return prev
    }, { replace: true })
  }
  // `/keys?add=<platform>` opens Add key preselected to that provider, so other
  // pages can send the user straight to the one key they need (e.g. the
  // Decision routing setup guide, #1354). Unknown values are ignored.
  const linkedPlatform = LISTED_PLATFORMS.find(p => p.value === searchParams.get('add'))?.value
  const [addOpen, setAddOpen] = useState(linkedPlatform !== undefined)
  // Provider the Add key dialog opens preselected to, when the add flow was
  // entered from a checklist chip (or a link) rather than the generic Add key button.
  const [addPlatform, setAddPlatform] = useState<Platform | ''>(linkedPlatform ?? '')
  // Drop the param once read, so closing the dialog and reloading does not reopen it.
  useEffect(() => {
    if (searchParams.has('add')) setSearchParams(prev => { prev.delete('add'); return prev }, { replace: true })
  }, [searchParams, setSearchParams])
  const [exportOpen, setExportOpen] = useState(false)

  const openAddKey = (platform: Platform | '' = '') => {
    setAddPlatform(platform)
    setAddOpen(true)
  }

  // Kept at page level for the header's "Check all" gate; ProviderList runs the
  // same query (deduped by react-query) for the list itself.
  const { data: keys = [], error: keysFailure } = useQuery<ApiKey[]>({
    queryKey: ['keys'],
    queryFn: () => apiFetch('/api/keys'),
  })

  const { data: healthData, error: healthFailure } = useQuery<HealthData>({
    queryKey: ['health'],
    queryFn: () => apiFetch('/api/health'),
    refetchInterval: 30000,
  })

  // A failed load must not masquerade as "no keys yet".
  const loadFailure = keysFailure ?? healthFailure ?? null

  const checkAll = useMutation({
    mutationFn: () => apiFetch('/api/health/check-all', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['health'] })
      queryClient.invalidateQueries({ queryKey: ['keys'] })
      invalidateSearchQueries(queryClient)
    },
  })

  return (
    <div>
      <PageHeader
        title={t('keys.pageTitle')}
        description={t('keys.pageDescription')}
        actions={
          <>
            {(tab === 'providers' || tab === 'quotaSignals') && keys.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => checkAll.mutate()} disabled={checkAll.isPending}>
                {checkAll.isPending ? t('keys.checking') : t('keys.checkAll')}
              </Button>
            )}
            {keys.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}>
                <Download className="size-3.5" />
                {t('keys.export')}
              </Button>
            )}
            {tab === 'providers' && (
              <Button size="sm" onClick={() => openAddKey()}>
                <Plus className="size-3.5" />
                {t('keys.addKey')}
              </Button>
            )}
            <SegmentedControl
              value={tab}
              onValueChange={setTab}
              options={KEYS_TABS.map(tb => ({ value: tb.id, label: t(tb.labelKey) }))}
              ariaLabel={t('keys.pageTitle')}
              className="w-full sm:w-auto"
            />
          </>
        }
      />

      {loadFailure && (
        <div role="alert" className="ox-enter mb-6 rounded-3xl border border-destructive/40 bg-destructive/10 px-5 py-4 text-sm text-destructive">
          {t('keys.loadFailed')}{' '}
          {loadFailure instanceof Error ? loadFailure.message : String(loadFailure ?? '')}
        </div>
      )}

      <div className="space-y-8">
        {tab === 'apiKey' && (
          <>
            <UnifiedKeySection />
            <ClientProfilesSection />
            <ProxySettingsSection />
            <BackupsSection />
          </>
        )}

        {tab === 'anthropic' && <AnthropicSection />}
        {tab === 'agents' && <AgentCompatibilitySection />}

        {tab === 'quotaSignals' && (
          <QuotaSignalsSection states={healthData?.quotaStates ?? []} />
        )}

        {tab === 'providers' && (
          <>
            <ProviderChecklistSection onAddKey={platform => openAddKey(platform as Platform)} />
            <ProviderList onAddKey={() => openAddKey()} />
          </>
        )}
      </div>

      <AddKeyDialog open={addOpen} onOpenChange={setAddOpen} initialPlatform={addPlatform || undefined} />
      {/* Mounted only while open so the export flow always starts at step one
          and never retains a previously typed password. */}
      {exportOpen && <ExportKeysDialog open={exportOpen} onOpenChange={setExportOpen} />}
    </div>
  )
}
