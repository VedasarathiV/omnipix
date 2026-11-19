import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '@/components/page-header'
import { ModelsTabs } from '@/components/models-tabs'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { ComparePanel } from '@/components/arena/compare-panel'
import { EvalsPanel } from '@/components/arena/evals-panel'
import { ScorecardsPanel } from '@/components/arena/scorecards-panel'
import { useI18n } from '@/i18n'

export default function ArenaPage() {
  const { t } = useI18n()
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState<'compare' | 'evals' | 'scorecards'>('compare')

  // Deep links (?tab=evals) from the palette select the tab, applied during
  // render: the previous-link state applies each link exactly once, including
  // Back-button navigations, with no extra commit.
  const [consumedTabLink, setConsumedTabLink] = useState<string | null>(null)
  const linkedTab = searchParams.get('tab')
  if (linkedTab !== consumedTabLink) {
    setConsumedTabLink(linkedTab)
    if (linkedTab === 'compare' || linkedTab === 'evals' || linkedTab === 'scorecards') {
      setTab(linkedTab)
    }
  }

  return (
    <div>
      <PageHeader
        title={t('arena.title')}
        description={t('arena.description')}
        actions={<ModelsTabs />}
      />

      <div className="mb-6">
        <SegmentedControl
          value={tab}
          onValueChange={setTab}
          ariaLabel={t('arena.title')}
          options={[
            { value: 'compare', label: t('arena.tabCompare') },
            { value: 'evals', label: t('arena.tabEvals') },
            { value: 'scorecards', label: t('arena.tabScorecards') },
          ]}
        />
      </div>

      {tab === 'compare' && <ComparePanel />}
      {tab === 'evals' && <EvalsPanel />}
      {tab === 'scorecards' && <ScorecardsPanel />}
    </div>
  )
}
