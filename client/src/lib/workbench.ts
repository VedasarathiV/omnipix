// Shared workbench data: nav sections, sidebar links, storage keys, and the
// cross-component events the sidebar uses to drive pages. Pure data only —
// the activity bar, sidebar, and mobile navbar all read from here so the
// three can never disagree about what exists.
import { Bot, Boxes, ChartColumn, KeyRound, Sparkles, SquareTerminal, type LucideIcon } from 'lucide-react'

export interface NavEntry {
  to: string
  labelKey: string
}

// Chat first: starting a conversation is the product's front door, so it
// leads every nav surface (mobile menu, palette, activity bar order below).
export const navItems: NavEntry[] = [
  { to: '/playground', labelKey: 'nav.playground' },
  { to: '/agents', labelKey: 'nav.agents' },
  { to: '/models', labelKey: 'nav.models' },
  { to: '/keys', labelKey: 'nav.keys' },
  { to: '/analytics', labelKey: 'nav.analytics' },
  { to: '/premium', labelKey: 'nav.premium' },
]

// The modality pages behind "Models".
export const modelItems: NavEntry[] = [
  { to: '/models/chat', labelKey: 'models.chatModelsTab' },
  { to: '/models/image', labelKey: 'models.imageTab' },
  { to: '/models/video', labelKey: 'models.videoTab' },
  { to: '/models/audio', labelKey: 'models.audioTab' },
  { to: '/models/embeddings', labelKey: 'models.embeddingsTab' },
  { to: '/models/decision', labelKey: 'decision.tab' },
  { to: '/models/search', labelKey: 'search.tab' },
  { to: '/models/fusion', labelKey: 'models.fusionTab' },
  { to: '/models/arena', labelKey: 'models.arenaTab' },
]

// The pages that hang off "Analytics".
export const analyticsItems: NavEntry[] = [
  { to: '/analytics', labelKey: 'nav.analytics' },
  { to: '/logs', labelKey: 'nav.logs' },
]

// Sections rendered as a split control (mobile menu) or a sidebar group
// (workbench). Keyed by the section's `to` so every consumer stays one lookup.
export const navMenus: Record<
  string,
  { ariaKey: string; items: NavEntry[]; isActive: (pathname: string) => boolean }
> = {
  '/models': {
    ariaKey: 'nav.modelsMenu',
    items: modelItems,
    isActive: (pathname) => pathname.startsWith('/models'),
  },
  '/analytics': {
    ariaKey: 'nav.analyticsMenu',
    items: analyticsItems,
    isActive: (pathname) => pathname.startsWith('/analytics') || pathname.startsWith('/logs'),
  },
}

export interface WorkbenchSection {
  id: string
  /** Landing page navigated to. */
  to: string
  /** Section base from sectionForPath(); decides the active state. */
  base: string
  labelKey: string
  icon: LucideIcon
}

export const SECTIONS: WorkbenchSection[] = [
  { id: 'playground', to: '/playground', base: '/playground', labelKey: 'nav.playground', icon: SquareTerminal },
  { id: 'agents', to: '/agents', base: '/agents', labelKey: 'nav.agents', icon: Bot },
  { id: 'models', to: '/models/chat', base: '/models', labelKey: 'nav.models', icon: Boxes },
  { id: 'keys', to: '/keys', base: '/keys', labelKey: 'nav.keys', icon: KeyRound },
  { id: 'analytics', to: '/analytics', base: '/analytics', labelKey: 'nav.analytics', icon: ChartColumn },
  { id: 'premium', to: '/premium', base: '/premium', labelKey: 'nav.premium', icon: Sparkles },
]

/**
 * Section base for a pathname — the activity bar and sidebar follow the
 * route. Null when no section owns the route (NotFound, /), so nothing
 * claims current instead of wrongly lighting Models.
 */
export function sectionForPath(pathname: string): string | null {
  if (pathname.startsWith('/models')) return '/models'
  if (pathname.startsWith('/playground')) return '/playground'
  if (pathname.startsWith('/keys')) return '/keys'
  if (pathname.startsWith('/agents')) return '/agents'
  if (pathname.startsWith('/analytics') || pathname.startsWith('/logs')) return '/analytics'
  if (pathname.startsWith('/premium')) return '/premium'
  return null
}

/** localStorage keys for the workbench chrome state. */
export const SIDEBAR_OPEN_KEY = 'workbench.sidebarOpen'
export const PANEL_OPEN_KEY = 'workbench.panelOpen'
export const PANEL_TAB_KEY = 'workbench.panelTab'

/** Dispatched by the sidebar; the Playground opens the conversation. */
export const OPEN_CONVERSATION_EVENT = 'omnipix:open-conversation'
/** Dispatched by the sidebar; the Playground starts a fresh conversation. */
export const NEW_CONVERSATION_EVENT = 'omnipix:new-conversation'
/** Dispatched by the Playground after select/new/rename/delete so the
 *  sidebar's recent list and highlight stay live. */
export const CONVERSATIONS_CHANGED_EVENT = 'omnipix:conversations-changed'
