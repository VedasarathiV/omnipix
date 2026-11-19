import { PanelBottom, Search, Settings } from 'lucide-react'
import { NotificationBell } from '@/components/notification-bell'
import { Link, useLocation } from 'react-router-dom'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { SECTIONS, sectionForPath } from '@/lib/workbench'
import { BrandMark } from '@/components/brand'
import { openCommandPalette } from '@/components/command-palette-state'

export interface ActivityBarProps {
  premiumEnabled: boolean
  sidebarOpen: boolean
  onToggleSidebar: () => void
  panelOpen: boolean
  onTogglePanel: () => void
  onOpenSettings: () => void
  /** Rendered at the bottom (the account menu trigger). */
  accountAction: React.ReactNode
  /** Brand mark; the browser shell shows it here, desktop shows it in the title strip. */
  showBrand?: boolean
}

// VSCode-style activity bar: a slim icon rail. Clicking a section navigates
// to its landing page; clicking the active one toggles the sidebar.
export function ActivityBar({ premiumEnabled, sidebarOpen, onToggleSidebar, panelOpen, onTogglePanel, onOpenSettings, accountAction, showBrand }: ActivityBarProps) {
  const { t } = useI18n()
  const location = useLocation()
  const activeSection = sectionForPath(location.pathname)
  const visible = SECTIONS.filter(s => s.id !== 'premium' || premiumEnabled)

  const iconClass = (active: boolean) =>
    cn(
      'relative flex size-11 items-center justify-center rounded-lg transition-colors',
      active ? 'text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted',
    )

  return (
    <nav aria-label={t('workbench.sections')} className="flex w-13 shrink-0 flex-col items-center gap-0.5 border-e bg-sidebar py-2">
      {showBrand && (
        <span className="mb-1 flex size-11 items-center justify-center" aria-hidden="true">
          <BrandMark size={20} />
        </span>
      )}
      {visible.map(section => {
        const Icon = section.icon
        // Plain Link, not NavLink: "current" here means section match (any
        // child page counts), which NavLink's own pathname match cannot
        // express — it would drop aria-current off non-landing pages.
        const active = activeSection === section.base
        const pressed = active && sidebarOpen
        return (
          <Link
            key={section.id}
            to={section.to}
            aria-label={t(section.labelKey)}
            title={t(section.labelKey)}
            aria-current={active ? 'page' : undefined}
            aria-expanded={active ? sidebarOpen : undefined}
            onClick={active ? (e) => { e.preventDefault(); onToggleSidebar() } : undefined}
            className={iconClass(active)}
          >
            {pressed && <span aria-hidden="true" className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary" />}
            <Icon className="size-5" strokeWidth={1.75} />
          </Link>
        )
      })}
      <div className="mt-auto flex flex-col items-center gap-0.5">
        <button
          type="button"
          onClick={openCommandPalette}
          aria-label={t('palette.title')}
          title={`${t('palette.title')} (${typeof navigator !== 'undefined' && /mac/i.test(navigator.platform) ? '⌘K' : 'Ctrl+K'})`}
          className={iconClass(false)}
        >
          <Search className="size-5" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          id="workbench-panel-toggle"
          onClick={onTogglePanel}
          aria-label={t('workbench.togglePanel')}
          title={t('workbench.togglePanel')}
          aria-pressed={panelOpen}
          className={iconClass(panelOpen)}
        >
          <PanelBottom className="size-5" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label={t('nav.settings')}
          title={t('nav.settings')}
          className={iconClass(false)}
        >
          <Settings className="size-5" strokeWidth={1.75} />
        </button>
        <NotificationBell />
        {accountAction}
      </div>
    </nav>
  )
}
