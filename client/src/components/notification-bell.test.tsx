// @vitest-environment jsdom
// Notification bell: shows the unread badge, lists notifications, marks one
// read on open, and marks all read.
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@/i18n'
import { apiFetch } from '@/lib/api'
import { NotificationBell } from './notification-bell'

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn(), getToken: () => null }))

const mocked = vi.mocked(apiFetch)
let root: Root
let container: HTMLDivElement
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }

const NOTES = [
  { id: 3, kind: 'approval-pending', title: 'Approval needed: shell_exec', body: 'Run: ls', link: '/agents?tab=approvals', read: 0, created_at: new Date().toISOString() },
  { id: 2, kind: 'automation-done', title: "Automation 'brief' done", body: '', link: '', read: 1, created_at: new Date().toISOString() },
]

function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })
  root.render(
    <MemoryRouter initialEntries={['/']}>
      <QueryClientProvider client={client}>
        <I18nProvider>
          <NotificationBell />
        </I18nProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

beforeAll(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mocked.mockReset()
  mocked.mockResolvedValue({ notifications: NOTES, unread: 1 } as never)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

it('shows the unread badge and marks all read', async () => {
  const calls: Array<{ path: string; options?: RequestInit }> = []
  mocked.mockImplementation(async (path: string, options?: RequestInit) => {
    calls.push({ path, options })
    if (!options?.method) return { notifications: NOTES, unread: 1 } as never
    return { read: 1, unread: 0 } as never
  })
  render()
  await flush()
  expect(container.textContent).toContain('1')
  const bell = container.querySelector('button[aria-label="Notifications"]') as HTMLButtonElement
  await act(async () => { bell.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  expect(document.body.textContent).toContain('Approval needed: shell_exec')
  const readAll = Array.from(document.body.querySelectorAll('button')).find(b => b.textContent === 'Mark all read') as HTMLButtonElement
  await act(async () => { readAll.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  expect(calls.some(c => c.path === '/api/notifications/read-all')).toBe(true)
})
