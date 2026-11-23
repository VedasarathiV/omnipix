// The Keys page tabs, shared by the page's segmented control and the
// workbench sidebar's deep links. Pure data (see the react-refresh rule).

export type KeysTab = 'providers' | 'quotaSignals' | 'apiKey' | 'anthropic' | 'agents'

export const KEYS_TABS: { id: KeysTab; labelKey: string }[] = [
  { id: 'providers', labelKey: 'keys.tabProviders' },
  { id: 'quotaSignals', labelKey: 'keys.tabQuotaSignals' },
  { id: 'apiKey', labelKey: 'keys.tabApiKey' },
  { id: 'anthropic', labelKey: 'keys.tabAnthropic' },
  { id: 'agents', labelKey: 'keys.tabAgents' },
]
