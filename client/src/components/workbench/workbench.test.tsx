// @vitest-environment jsdom
// Workbench shell: activity bar sections, contextual sidebar, bottom panel.
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@/i18n'
import { Workbench } from './workbench'
import { apiFetch } from '@/lib/api'
import { NEW_CONVERSATION_EVENT, OPEN_CONVERSATION_EVENT } from '@/lib/workbench'

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }))

let root: Root
let container: HTMLDivElement
beforeAll(() => { (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true })
beforeEach(() => {
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  localStorage.clear()
  vi.mocked(apiFetch).mockImplementation(async (url: string) => {
    if (url === '/api/conversations') {
      return [{ id: 7, title: 'Chat seven', model: 'auto', messageCount: 4, createdAt: 1, updatedAt: 2 }] as never
    }
    if (url.startsWith('/api/logs')) {
      return { entries: [{ id: 1, ts: new Date().toISOString(), level: 'error', message: 'boom happened' }], nextId: 1, counts: {} } as never
    }
    if (url === '/api/health') {
      return { platforms: [], keys: [{ id: 1, platform: 'groq', status: 'healthy', lastCheckedAt: null, lastHealthError: null }], quotaStates: [] } as never
    }
    return {} as never
  })
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks() })

const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }

function mount(path: string, props: Partial<Parameters<typeof Workbench>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const callbacks = {
    premiumEnabled: false,
    showUpgrade: false,
    onOpenSettings: vi.fn(),
    onOpenUpdates: vi.fn(),
    onChangeEmail: vi.fn(),
    onChangePassword: vi.fn(),
    ...props,
  }
  act(() => root.render(
    <QueryClientProvider client={client}>
      <I18nProvider initialLocale="en">
        <MemoryRouter initialEntries={[path]}>
          <Workbench {...callbacks}><div>page-body</div></Workbench>
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  ))
  return callbacks
}

const activityLabels = () => [...container.querySelectorAll('nav[aria-label="Sections"] a')].map(a => a.getAttribute('aria-label'))

it('marks the route section current and hides premium when disabled', async () => {
  mount('/models/chat')
  await flush()
  expect(activityLabels()).toEqual(['Chat', 'Agents', 'Models', 'Keys', 'Analytics'])
  const current = container.querySelector('nav[aria-label="Sections"] a[aria-current="page"]')
  expect(current?.getAttribute('aria-label')).toBe('Models')
  expect(container.textContent).toContain('page-body')
})

it('shows premium when enabled', async () => {
  mount('/models/chat', { premiumEnabled: true })
  await flush()
  expect(activityLabels()).toContain('Premium')
})

it('models sidebar lists the modality links, including Arena', async () => {
  mount('/models/chat')
  await flush()
  expect(container.textContent).toContain('Arena')
  expect(container.textContent).toContain('Chat models')
})

it('analytics sidebar links Analytics and Logs', async () => {
  mount('/logs')
  await flush()
  const links = [...container.querySelectorAll('aside a')]
  expect(links.map(a => a.textContent)).toEqual(['Analytics', 'Logs'])
  expect(links[1].getAttribute('href')).toBe('/logs')
  const current = container.querySelector('nav[aria-label="Sections"] a[aria-current="page"]')
  expect(current?.getAttribute('aria-label')).toBe('Analytics')
})

it('clicking the active activity icon toggles the sidebar', async () => {
  mount('/models/chat')
  await flush()
  const models = [...container.querySelectorAll('nav[aria-label="Sections"] a')].find(a => a.getAttribute('aria-label') === 'Models')!
  act(() => { models.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  expect(container.textContent).not.toContain('Arena')
  expect(localStorage.getItem('workbench.sidebarOpen')).toBe('0')
})

it('keys sidebar deep-links tabs', async () => {
  mount('/keys')
  await flush()
  const link = [...container.querySelectorAll('aside a')].find(a => a.textContent === 'Unified API key')
  expect(link?.getAttribute('href')).toBe('/keys?tab=apiKey')
})

it('playground sidebar starts chats and opens recents by event', async () => {
  mount('/playground')
  await flush()
  const seen: string[] = []
  const onOpen = (e: Event) => seen.push(`open:${(e as CustomEvent).detail.id}`)
  const onNew = () => seen.push('new')
  window.addEventListener(OPEN_CONVERSATION_EVENT, onOpen)
  window.addEventListener(NEW_CONVERSATION_EVENT, onNew)
  try {
    expect(container.textContent).toContain('Chat seven')
    const recent = [...container.querySelectorAll('aside button')].find(b => b.textContent === 'Chat seven')!
    act(() => { recent.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const fresh = [...container.querySelectorAll('aside button')].find(b => b.textContent === 'New chat')!
    act(() => { fresh.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(seen).toEqual(['open:7', 'new'])
  } finally {
    window.removeEventListener(OPEN_CONVERSATION_EVENT, onOpen)
    window.removeEventListener(NEW_CONVERSATION_EVENT, onNew)
  }
})

it('panel toggles, tails logs, and Cmd+J flips it', async () => {
  mount('/models/chat')
  await flush()
  expect(container.textContent).not.toContain('boom happened')
  const toggle = container.querySelector('[aria-label="Toggle panel"]')!
  act(() => { toggle.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  expect(container.textContent).toContain('boom happened')
  expect(localStorage.getItem('workbench.panelOpen')).toBe('1')
  act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', metaKey: true, bubbles: true })) })
  await flush()
  expect(container.textContent).not.toContain('boom happened')
})

it('panel close returns focus to the toggle', async () => {
  mount('/models/chat')
  await flush()
  const toggle = container.querySelector('#workbench-panel-toggle') as HTMLElement
  act(() => { toggle.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  const close = [...container.querySelectorAll('section [aria-label="Toggle panel"]')][0] as HTMLElement
  close.focus()
  act(() => { close.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  expect(document.activeElement).toBe(toggle)
})

it('panel health tab counts keys', async () => {
  mount('/models/chat')
  await flush()
  act(() => { container.querySelector('[aria-label="Toggle panel"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  const health = [...container.querySelectorAll('[role="tab"]')].find(t => t.textContent === 'Health')!
  act(() => { health.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  expect(container.textContent).toContain('1 of 1 keys healthy')
})
