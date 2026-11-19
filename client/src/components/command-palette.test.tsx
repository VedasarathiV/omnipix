// @vitest-environment jsdom
// Command palette agent commands: filter to the approvals inbox entry and run
// it, navigating to the deep-linked tab.
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@/i18n'
import { apiFetch } from '@/lib/api'
import { ThemeProvider } from '@/theme'
import { CommandPalette } from './command-palette'

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn(), getToken: () => null }))

const mocked = vi.mocked(apiFetch)
let root: Root
let container: HTMLDivElement
let currentPath = ''
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }

function PathProbe() {
  // Test probe: records the router location for assertions.
  // eslint-disable-next-line react-hooks/globals
  currentPath = useLocation().pathname + useLocation().search
  return null
}

function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  root.render(
    <MemoryRouter initialEntries={['/']}>
      <QueryClientProvider client={client}>
        <I18nProvider>
          <ThemeProvider>
            <Routes>
              <Route path="*" element={<><PathProbe /><CommandPalette /></>} />
            </Routes>
          </ThemeProvider>
        </I18nProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

beforeAll(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  })
})

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  currentPath = ''
  mocked.mockReset()
  mocked.mockImplementation(async (path: string) => {
    if (path === '/api/fallback') return [] as never
    if (path === '/api/settings/api-key') return { apiKey: 'x' } as never
    if (path.startsWith('/api/premium')) return { enabled: false } as never
    return {} as never
  })
})
afterEach(() => { act(() => root.unmount()); container.remove() })

function setInput(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

it('runs the approvals inbox command to its deep link', async () => {
  render()
  await flush()
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
  })
  await flush()
  const input = container.querySelector('input[aria-controls="command-palette-list"]') as HTMLInputElement
  expect(input).toBeTruthy()
  await act(async () => { setInput(input, 'approv') })
  await flush()
  expect(container.textContent).toContain('Open approvals inbox')
  const row = Array.from(container.querySelectorAll('[role="option"]')).find(el => el.textContent?.includes('Open approvals inbox')) as HTMLElement
  await act(async () => { row.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  expect(currentPath).toBe('/agents?tab=approvals')
})
