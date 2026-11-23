import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { CircleUserRound } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useI18n } from '@/i18n'
import { isDesktopApp, isMacDesktop } from '@/lib/desktop-env'
import { PANEL_OPEN_KEY, PANEL_TAB_KEY, SIDEBAR_OPEN_KEY } from '@/lib/workbench'
import { OPEN_PANEL_EVENT } from '@/lib/open-folder'
import { AccountMenuItems } from '@/components/account-menu-items'
import { BrandMark } from '@/components/brand'
import { ActivityBar } from './activity-bar'
import { Sidebar } from './sidebar'
import { Panel, type PanelTab } from './panel'

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key)
    return v === null ? fallback : v === '1'
  } catch {
    return fallback
  }
}

function writeFlag(key: string, value: boolean) {
  try { localStorage.setItem(key, value ? '1' : '0') } catch { /* ignore */ }
}

export interface WorkbenchProps {
  onOpenSettings: () => void
  onOpenUpdates: () => void
  onChangeEmail: () => void
  onChangePassword: () => void
  children: ReactNode
}

// The desktop-width shell: activity bar, contextual sidebar, content, and a
// collapsible bottom panel. Below md the mobile navbar takes over instead
// (see App.tsx), so this tree only ever renders at workbench widths.
export function Workbench({ onOpenSettings, onOpenUpdates, onChangeEmail, onChangePassword, children }: WorkbenchProps) {
  const { t } = useI18n()
  const [sidebarOpen, setSidebarOpen] = useState(() => readFlag(SIDEBAR_OPEN_KEY, true))
  const [panelOpen, setPanelOpen] = useState(() => readFlag(PANEL_OPEN_KEY, false))
  const [panelTab, setPanelTab] = useState<PanelTab>(() => {
    try {
      const v = localStorage.getItem(PANEL_TAB_KEY)
      return v === 'health' || v === 'terminal' || v === 'files' ? v : 'logs'
    } catch { return 'logs' }
  })

  const toggleSidebar = useCallback(() => {
    setSidebarOpen(prev => { writeFlag(SIDEBAR_OPEN_KEY, !prev); return !prev })
  }, [])
  const togglePanel = useCallback(() => {
    setPanelOpen(prev => { writeFlag(PANEL_OPEN_KEY, !prev); return !prev })
  }, [])
  const changePanelTab = useCallback((tab: PanelTab) => {
    setPanelTab(tab)
    try { localStorage.setItem(PANEL_TAB_KEY, tab) } catch { /* ignore */ }
  }, [])
  // Deep-open: the sidebar's Browse button lands on the Files tab.
  useEffect(() => {
    const open = (e: Event) => {
      const tab = (e as CustomEvent<{ tab: PanelTab }>).detail?.tab
      if (tab === 'logs' || tab === 'health' || tab === 'terminal' || tab === 'files') {
        changePanelTab(tab)
        setPanelOpen(true)
        writeFlag(PANEL_OPEN_KEY, true)
      }
    }
    window.addEventListener(OPEN_PANEL_EVENT, open)
    return () => window.removeEventListener(OPEN_PANEL_EVENT, open)
  }, [changePanelTab])

  // Cmd/Ctrl+J toggles the panel, as in VSCode. Never while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        const el = e.target as HTMLElement | null
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
        e.preventDefault()
        togglePanel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePanel])

  return (
    <>
      {/* Desktop title strip: the window drag handle with traffic-light room.
          The browser build needs none of it — the activity bar carries the
          brand there. */}
      {isDesktopApp && (
        <div
          className={`hidden shrink-0 items-center border-b md:flex ${isMacDesktop ? 'pl-20' : 'px-3'}`}
          style={{ WebkitAppRegion: 'drag', minHeight: 36 } as React.CSSProperties}
        >
          <span className="flex items-center gap-3" aria-hidden="true">
            <BrandMark size={24} animated />
            <span className="text-[15px] font-semibold tracking-tight">OmniPix</span>
          </span>
        </div>
      )}
      {/* One content column for every width: on mobile the page fills the
          space under the navbar; at md+ the activity bar and sidebar join
          the row and only this column scrolls. (The old `hidden md:flex`
          row swallowed page content below md entirely.) */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="hidden shrink-0 md:contents">
        <ActivityBar
          sidebarOpen={sidebarOpen}
          onToggleSidebar={toggleSidebar}
          panelOpen={panelOpen}
          onTogglePanel={togglePanel}
          onOpenSettings={onOpenSettings}
          showBrand={!isDesktopApp}
          accountAction={
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={t('nav.openMenu')}
                className="relative flex size-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <CircleUserRound className="size-5" strokeWidth={1.75} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="right" className="w-48">
                <AccountMenuItems
                  showSettings={false}
                  settingsLabel={t('nav.settings')}
                  updatesLabel={t('settings.checkForUpdates')}
                  signOutLabel={t('nav.signOut')}
                  changeEmailLabel={t('auth.changeEmail')}
                  changePasswordLabel={t('auth.changePassword')}
                  onOpenSettings={onOpenSettings}
                  onOpenUpdates={onOpenUpdates}
                  onChangeEmail={onChangeEmail}
                  onChangePassword={onChangePassword}
                  isDesktopApp={isDesktopApp}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          }
        />
        {sidebarOpen && <Sidebar />}
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {children}
          {panelOpen && (
            <div className="hidden min-h-0 md:contents">
            <Panel
              tab={panelTab}
              onTabChange={changePanelTab}
              onClose={() => {
                togglePanel()
                // The close button unmounts with the panel — land focus on
                // the toggle instead of dropping it to the body.
                document.getElementById('workbench-panel-toggle')?.focus()
              }}
            />
            </div>
          )}
        </div>
      </div>
    </>
  )
}
