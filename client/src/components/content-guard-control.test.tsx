// @vitest-environment jsdom
// Content-guard control: shows modes, blocklist, and live stats; saving the
// blocklist PUTs one regex per line.
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@/i18n'
import { apiFetch } from '@/lib/api'
import { ContentGuardControl } from './content-guard-control'

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn(), getToken: () => null }))

const mocked = vi.mocked(apiFetch)
let root: Root
let container: HTMLDivElement
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }

const STATE = {
  inbound: 'block',
  outbound: 'off',
  blockedPatterns: ['secret-recipe'],
  stats: { inboundRedactions: 4, inboundBlocks: 2, outboundRedactions: 0 },
}

function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  root.render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <ContentGuardControl />
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
  mocked.mockResolvedValue(STATE as never)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

it('shows the modes, patterns, and stats', async () => {
  render()
  await flush()
  expect(container.textContent).toContain('Content guardrails')
  const area = container.querySelector('#content-guard-patterns') as HTMLTextAreaElement
  expect(area.value).toBe('secret-recipe')
  expect(container.textContent).toContain('2 blocked')
  expect(container.textContent).toContain('4 inbound redactions')
})

it('saves the edited blocklist as one regex per line', async () => {
  const calls: Array<{ path: string; options?: RequestInit }> = []
  mocked.mockImplementation(async (path: string, options?: RequestInit) => {
    calls.push({ path, options })
    return STATE as never
  })
  render()
  await flush()
  const area = container.querySelector('#content-guard-patterns') as HTMLTextAreaElement
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!.call(area, 'aaa\n\nbbb\n')
    area.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await flush()
  const save = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Save') as HTMLButtonElement
  await act(async () => { save.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  const put = calls.find(c => c.options?.method === 'PUT')
  expect(put?.path).toBe('/api/settings/content-guard')
  expect(JSON.parse(String(put?.options?.body))).toEqual({ blockedPatterns: ['aaa', 'bbb'] })
})
