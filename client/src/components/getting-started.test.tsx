// @vitest-environment jsdom
// Getting-started checklist: the agent nudge appears only once routing works
// (keys + a request) and the user still hasn't tried an agent run.
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@/i18n'
import { apiFetch } from '@/lib/api'
import { GettingStarted } from './getting-started'

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn(), getToken: () => null }))

const mocked = vi.mocked(apiFetch)
let root: Root
let container: HTMLDivElement
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }

function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  root.render(
    <MemoryRouter initialEntries={['/models/chat']}>
      <QueryClientProvider client={client}>
        <I18nProvider>
          <GettingStarted />
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
  localStorage.clear()
})
afterEach(() => { act(() => root.unmount()); container.remove() })

function mockState(keys: unknown[], totalRequests: number, runs: unknown[]) {
  mocked.mockImplementation(async (path: string) => {
    if (path === '/api/keys') return keys as never
    if (path.startsWith('/api/analytics/summary')) return { totalRequests } as never
    if (path === '/api/settings/api-key') return { apiKey: 'u-key' } as never
    if (path === '/api/agents/runs?limit=1') return { runs } as never
    throw new Error(`unexpected ${path}`)
  })
}

it('shows the agent nudge once routing works but no run exists', async () => {
  mockState([{ id: 1 }], 5, [])
  render()
  await flush()
  expect(container.textContent).toContain('Next: try an agent')
})

it('hides entirely once an agent run exists', async () => {
  mockState([{ id: 1 }], 5, [{ id: 1 }])
  render()
  await flush()
  expect(container.textContent).not.toContain('Next: try an agent')
  expect(container.textContent).not.toContain('Getting started')
})

it('shows no nudge before routing works', async () => {
  mockState([], 0, [])
  render()
  await flush()
  expect(container.textContent).toContain('Getting started')
  expect(container.textContent).not.toContain('Next: try an agent')
})
