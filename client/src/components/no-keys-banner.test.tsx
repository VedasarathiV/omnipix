// @vitest-environment jsdom
// First-run banner: shows when no keyed model exists anywhere, hides on the
// Keys page itself and once any model is keyed.
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@/i18n'
import { apiFetch } from '@/lib/api'
import { NoKeysBanner } from './no-keys-banner'

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn(), getToken: () => null }))

const mocked = vi.mocked(apiFetch)
let root: Root
let container: HTMLDivElement
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }

function render(entry = '/playground') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  root.render(
    <MemoryRouter initialEntries={[entry]}>
      <QueryClientProvider client={client}>
        <I18nProvider>
          <NoKeysBanner />
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
})
afterEach(() => { act(() => root.unmount()); container.remove() })

it('shows on any page when nothing is keyed', async () => {
  mocked.mockResolvedValue([{ enabled: true, keyCount: 0 }] as never)
  render('/playground')
  await flush()
  expect(container.textContent).toContain('No provider keys yet')
  expect(container.textContent).toContain('Add keys')
})

it('hides on the Keys page and once a model is keyed', async () => {
  mocked.mockResolvedValue([{ enabled: true, keyCount: 0 }] as never)
  render('/keys')
  await flush()
  expect(container.textContent).toBe('')
  act(() => root.unmount())
  container.remove()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mocked.mockResolvedValue([{ enabled: true, keyCount: 2 }] as never)
  render('/playground')
  await flush()
  expect(container.textContent).toBe('')
})
