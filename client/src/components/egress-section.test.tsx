// @vitest-environment jsdom
// Egress section: renders proxy state from /api/settings/proxy, toggles the
// enabled switch immediately, and saves the form through PUT.
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@/i18n'
import { apiFetch } from '@/lib/api'
import { EgressSection } from './egress-section'

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn(), getToken: () => null }))

const mocked = vi.mocked(apiFetch)
let root: Root
let container: HTMLDivElement
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }

const PROXY = {
  proxyUrl: 'socks5://127.0.0.1:7890',
  proxyMode: 'forward',
  fetchRelayTokenConfigured: false,
  enabled: true,
  bypassPlatforms: ['groq'],
  active: true,
}

function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  root.render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <EgressSection />
      </I18nProvider>
    </QueryClientProvider>,
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
  mocked.mockImplementation(async (path: string, options?: { method?: string; body?: string }) => {
    if (path === '/api/settings/proxy' && (!options || options.method === undefined || options.method === 'GET')) {
      return PROXY as never
    }
    if (path === '/api/settings/proxy' && options?.method === 'PUT') {
      const patch = JSON.parse(options.body ?? '{}')
      return { ...PROXY, ...patch, bypassPlatforms: patch.bypassPlatforms ?? PROXY.bypassPlatforms } as never
    }
    throw new Error(`unexpected ${path}`)
  })
})
afterEach(() => { act(() => root.unmount()); container.remove() })

it('renders proxy state and the active status line', async () => {
  render()
  await flush()
  const url = container.querySelector('#egress-url') as HTMLInputElement
  expect(url.value).toBe('socks5://127.0.0.1:7890')
  const status = container.querySelector('[role="status"]')
  expect(status?.textContent).toContain('Proxy active')
  const bypass = container.querySelector('#egress-bypass') as HTMLInputElement
  expect(bypass.value).toBe('groq')
})

it('saves the form without sending an empty relay token', async () => {
  render()
  await flush()
  const url = container.querySelector('#egress-url') as HTMLInputElement
  await act(async () => {
    // React tracks controlled inputs past direct assignment; go through the
    // native setter so onChange fires.
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(url, 'http://proxy.test:8080')
    url.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const save = [...container.querySelectorAll('button')].find(b => b.textContent === 'Save changes')
  expect(save).toBeTruthy()
  await act(async () => { save!.click() })
  await flush()
  const put = mocked.mock.calls.find(([, options]) => (options as { method?: string } | undefined)?.method === 'PUT')
  expect(put).toBeTruthy()
  const body = JSON.parse((put![1] as { body: string }).body)
  expect(body.proxyUrl).toBe('http://proxy.test:8080')
  // Empty token input must not clear the saved relay token.
  expect('fetchRelayToken' in body).toBe(false)
})
