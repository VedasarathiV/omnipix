import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { MessageSquarePlus } from 'lucide-react'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { analyticsItems, CONVERSATIONS_CHANGED_EVENT, modelItems, NEW_CONVERSATION_EVENT, OPEN_CONVERSATION_EVENT, sectionForPath } from '@/lib/workbench'
import { listConversations, readActiveConversationId, writeActiveConversationId, type ConversationSummary } from '@/lib/playground-conversations'
import { KEYS_TABS } from '@/lib/keys-tabs'

// The workbench sidebar: navigation for the active section. It always follows
// the route (never its own selection state), so it can never disagree with
// the page on screen.

function SectionLink({ to, label, end }: { to: string; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'block truncate rounded-lg px-3 py-1.5 text-[13px] transition-colors',
          isActive ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        )
      }
    >
      {label}
    </NavLink>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</h2>
}

function ModelsSection() {
  const { t } = useI18n()
  return (
    <div>
      <SectionTitle>{t('nav.models')}</SectionTitle>
      <div className="space-y-px px-1.5">
        {modelItems.map(item => (
          <SectionLink key={item.to} to={item.to} label={t(item.labelKey)} />
        ))}
      </div>
    </div>
  )
}

function PlaygroundSection() {
  const { t } = useI18n()
  const location = useLocation()
  const navigate = useNavigate()
  const [recent, setRecent] = useState<ConversationSummary[]>([])
  const [activeId, setActiveId] = useState<number | null>(() => {
    try { return readActiveConversationId() } catch { return null }
  })
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const all = await listConversations()
        if (!cancelled) setRecent([...all].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8))
      } catch {
        if (!cancelled) setRecent([])
      }
      if (cancelled) return
      try { setActiveId(readActiveConversationId()) } catch { setActiveId(null) }
    }
    void load()
    // The Playground announces every select/new/rename/delete, so opening or
    // creating a chat refreshes this list without a navigation.
    window.addEventListener(CONVERSATIONS_CHANGED_EVENT, load)
    return () => { cancelled = true; window.removeEventListener(CONVERSATIONS_CHANGED_EVENT, load) }
  }, [location.pathname])

  const openConversation = (id: number) => {
    if (location.pathname === '/playground') {
      window.dispatchEvent(new CustomEvent(OPEN_CONVERSATION_EVENT, { detail: { id } }))
    } else {
      // The Playground restores the stored id on mount.
      try { writeActiveConversationId(id) } catch { /* ignore */ }
      navigate('/playground')
    }
  }
  const newChat = () => {
    if (location.pathname === '/playground') {
      window.dispatchEvent(new Event(NEW_CONVERSATION_EVENT))
    } else {
      // A null stored id mounts the Playground empty.
      try { writeActiveConversationId(null) } catch { /* ignore */ }
      navigate('/playground')
    }
  }

  return (
    <div>
      <SectionTitle>{t('nav.playground')}</SectionTitle>
      <div className="space-y-px px-1.5">
        <button
          type="button"
          onClick={newChat}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <MessageSquarePlus className="size-3.5 shrink-0" aria-hidden="true" />
          {t('workbench.newChat')}
        </button>
      </div>
      <SectionTitle>{t('workbench.recentChats')}</SectionTitle>
      <div className="space-y-px px-1.5">
        {recent.length === 0 ? (
          <p className="px-3 py-1.5 text-[13px] text-muted-foreground/70">{t('workbench.noRecentChats')}</p>
        ) : (
          recent.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => openConversation(c.id)}
              title={c.title}
              aria-current={location.pathname === '/playground' && activeId === c.id ? 'page' : undefined}
              className={cn(
                'block w-full truncate rounded-lg px-3 py-1.5 text-left text-[13px] transition-colors',
                location.pathname === '/playground' && activeId === c.id
                  ? 'bg-accent font-medium text-accent-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {c.title}
            </button>
          ))
        )}
      </div>
    </div>
  )
}

function KeysSection() {
  const { t } = useI18n()
  const [searchParams] = useSearchParams()
  // Same derivation as KeysPage (unknown values fall back to providers),
  // so the highlight always agrees with the visible tab.
  const activeTab = KEYS_TABS.some(tb => tb.id === searchParams.get('tab'))
    ? searchParams.get('tab')
    : 'providers'
  return (
    <div>
      <SectionTitle>{t('nav.keys')}</SectionTitle>
      <div className="space-y-px px-1.5">
        {KEYS_TABS.map(tab => {
          // Plain Link, not NavLink: all five share the /keys pathname, so
          // NavLink would mark every one of them current at once.
          const active = activeTab === tab.id
          return (
            <Link
              key={tab.id}
              to={tab.id === 'providers' ? '/keys' : `/keys?tab=${tab.id}`}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'block truncate rounded-lg px-3 py-1.5 text-[13px] transition-colors',
                active ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {t(tab.labelKey)}
            </Link>
          )
        })}
      </div>
    </div>
  )
}

function AnalyticsSection() {
  const { t } = useI18n()
  return (
    <div>
      <SectionTitle>{t('nav.analytics')}</SectionTitle>
      <div className="space-y-px px-1.5">
        {analyticsItems.map(item => (
          <SectionLink key={item.to} to={item.to} label={t(item.labelKey)} end />
        ))}
      </div>
    </div>
  )
}

function SingleLinkSection({ to, labelKey }: { to: string; labelKey: string }) {
  const { t } = useI18n()
  return (
    <div>
      <SectionTitle>{t(labelKey)}</SectionTitle>
      <div className="space-y-px px-1.5">
        <SectionLink to={to} label={t(labelKey)} />
      </div>
    </div>
  )
}

export function Sidebar() {
  const { t } = useI18n()
  const location = useLocation()
  const section = sectionForPath(location.pathname)
  // No section owns this route (NotFound, /): render nothing rather than an
  // empty labeled landmark.
  if (!section) return null
  return (
    <aside aria-label={t('workbench.sidebarNav')} className="w-52 min-h-0 shrink-0 overflow-y-auto border-e bg-sidebar py-1">
      {section === '/models' && <ModelsSection />}
      {section === '/playground' && <PlaygroundSection />}
      {section === '/keys' && <KeysSection />}
      {section === '/agents' && <SingleLinkSection to="/agents" labelKey="nav.agents" />}
      {section === '/analytics' && <AnalyticsSection />}
      {section === '/premium' && <SingleLinkSection to="/premium" labelKey="nav.premium" />}
    </aside>
  )
}
