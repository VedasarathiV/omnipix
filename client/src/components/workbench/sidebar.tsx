import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { FolderGit2, MessageSquarePlus, X } from 'lucide-react'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/toast'
import { analyticsItems, CONVERSATIONS_CHANGED_EVENT, modelItems, NEW_CONVERSATION_EVENT, OPEN_CONVERSATION_EVENT, OPEN_FOLDER_EVENT, sectionForPath } from '@/lib/workbench'
import { canPickFolder, pickFolderTree, readFolderTree } from '@/lib/desktop-folder'
import { FOLDER_CHANGED_EVENT, OPEN_PANEL_EVENT, readRecentFolders, setOpenFolder, useOpenFolder } from '@/lib/open-folder'
import { folderBasename, listConversations, readActiveConversationId, writeActiveConversationId, type ConversationSummary } from '@/lib/playground-conversations'
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

// Recently opened project folders (desktop only): one click re-reads the
// tree fresh and jumps to the chat. The open folder is excluded — it has
// its own section above.
function RecentFolders({ current }: { current: string | null }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const [recent, setRecent] = useState<string[]>(() => readRecentFolders())
  useEffect(() => {
    const sync = () => setRecent(readRecentFolders())
    window.addEventListener(FOLDER_CHANGED_EVENT, sync)
    return () => window.removeEventListener(FOLDER_CHANGED_EVENT, sync)
  }, [])
  const rows = recent.filter(r => r !== current)
  if (rows.length === 0) return null
  const reopen = async (root: string) => {
    try {
      const tree = await readFolderTree(root)
      setOpenFolder({ root: tree.root, tree: tree.tree, files: tree.files, truncated: tree.truncated })
      try { localStorage.setItem('panel.filesRoot', tree.root) } catch { /* ignore */ }
      if (location.pathname !== '/playground') navigate('/playground')
      setTimeout(() => window.dispatchEvent(new CustomEvent(OPEN_FOLDER_EVENT, { detail: tree })), 50)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }
  return (
    <>
      <SectionTitle>{t('workbench.recentFolders')}</SectionTitle>
      <div className="space-y-px px-1.5">
        {rows.map(root => (
          <button
            key={root}
            type="button"
            onClick={() => void reopen(root)}
            title={root}
            className="block w-full truncate rounded-lg px-3 py-1.5 text-left font-mono text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {folderBasename(root)}/
          </button>
        ))}
      </div>
    </>
  )
}

function PlaygroundSection() {
  const { t } = useI18n()
  const location = useLocation()
  const navigate = useNavigate()
  const [folder, setFolder] = useOpenFolder()
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
  const openFolder = async () => {
    try {
      const tree = await pickFolderTree()
      if (!tree) return
      setOpenFolder({ root: tree.root, tree: tree.tree, files: tree.files, truncated: tree.truncated })
      try { localStorage.setItem('panel.filesRoot', tree.root) } catch { /* ignore */ }
      if (location.pathname !== '/playground') navigate('/playground')
      // Legacy: the Playground also listens for the one-shot event.
      setTimeout(() => window.dispatchEvent(new CustomEvent(OPEN_FOLDER_EVENT, { detail: tree })), 50)
      // Show the files immediately: opening a folder with nowhere to see it
      // reads as broken. The Files tab follows panel.filesRoot on open.
      setTimeout(() => window.dispatchEvent(new CustomEvent(OPEN_PANEL_EVENT, { detail: { tab: 'files' } })), 100)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }
  const browseFolder = () => {
    if (!folder) return
    try { localStorage.setItem('panel.filesRoot', folder.root) } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent(OPEN_PANEL_EVENT, { detail: { tab: 'files' } }))
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
        {canPickFolder() && (
          <button
            type="button"
            onClick={() => void openFolder()}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <FolderGit2 className="size-3.5 shrink-0" aria-hidden="true" />
            {t('playground.folder')}
          </button>
        )}
      </div>
      {folder && (
        <>
          <SectionTitle>{t('workbench.openFolder')}</SectionTitle>
          <div className="group/folder relative">
            <button
              type="button"
              onClick={browseFolder}
              title={t('workbench.browseFolder')}
              className="block w-full truncate rounded-lg py-1.5 pl-3 pr-8 text-left text-[13px] font-medium text-foreground transition-colors hover:bg-muted"
            >
              <span className="font-mono">{folder.root.split('/').pop() || folder.root}/</span>
              <span className="ml-2 font-sans font-normal tabular-nums text-muted-foreground">{folder.files}</span>
            </button>
            <button
              type="button"
              onClick={() => setFolder(null)}
              aria-label={t('common.remove')}
              title={t('common.remove')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground opacity-0 transition-all hover:text-foreground focus-visible:opacity-100 group-hover/folder:opacity-100"
            >
              <X className="size-3.5" />
            </button>
          </div>
          <div className="px-1.5">
            <button
              type="button"
              onClick={newChat}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <MessageSquarePlus className="size-3.5 shrink-0" aria-hidden="true" />
              {t('workbench.newChatForFolder')}
            </button>
          </div>
        </>
      )}
      {canPickFolder() && <RecentFolders current={folder?.root ?? null} />}
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
              title={c.folderRoot ? `${c.title} — ${c.folderRoot}` : c.title}
              aria-current={location.pathname === '/playground' && activeId === c.id ? 'page' : undefined}
              className={cn(
                'block w-full truncate rounded-lg px-3 py-1.5 text-left text-[13px] transition-colors',
                location.pathname === '/playground' && activeId === c.id
                  ? 'bg-accent font-medium text-accent-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {c.title}
              {c.folderRoot && (
                <span className="ml-2 font-mono text-[10px] opacity-70">{folderBasename(c.folderRoot)}/</span>
              )}
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
    </aside>
  )
}
