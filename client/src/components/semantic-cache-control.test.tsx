// @vitest-environment jsdom
// Semantic-cache control: shows the threshold, validates 0..1, and PUTs the
// threshold alone so the master switch is never flipped as a side effect.
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@/i18n'
import { apiFetch } from '@/lib/api'
import { SemanticCacheControl } from './semantic-cache-control'

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn(), getToken: () => null }))

const mocked = vi.mocked(apiFetch)
let root: Root
let container: HTMLDivElement
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }

function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  root.render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <SemanticCacheControl />
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
  mocked.mockResolvedValue({ enabled: true, semanticThreshold: 0 } as never)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

function setValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

it('shows Disabled at threshold 0', async () => {
  render()
  await flush()
  expect(container.textContent).toContain('Semantic cache')
  expect(container.textContent).toContain('Disabled')
})

it('rejects out-of-range input and PUTs the threshold alone', async () => {
  const calls: Array<{ path: string; options?: RequestInit }> = []
  mocked.mockImplementation(async (path: string, options?: RequestInit) => {
    calls.push({ path, options })
    return { enabled: true, semanticThreshold: 0 } as never
  })
  render()
  await flush()
  const input = container.querySelector('#semantic-cache-threshold') as HTMLInputElement
  const save = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Save') as HTMLButtonElement
  await act(async () => { setValue(input, '7') })
  await flush()
  expect(save.disabled).toBe(true)
  await act(async () => { setValue(input, '0.9') })
  await flush()
  expect(save.disabled).toBe(false)
  await act(async () => { save.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  const put = calls.find(c => c.options?.method === 'PUT')
  expect(put?.path).toBe('/api/cache/config')
  expect(JSON.parse(String(put?.options?.body))).toEqual({ semanticThreshold: 0.9 })
})
