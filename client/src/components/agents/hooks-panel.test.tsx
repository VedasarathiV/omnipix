// @vitest-environment jsdom
// Hooks panel: lists hooks with event/tool badges, creates a hook through
// the dialog, and toggles enablement.
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@/i18n'
import { apiFetch } from '@/lib/api'
import { HooksPanel } from './hooks-panel'

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn(), getToken: () => null }))

const mocked = vi.mocked(apiFetch)
let root: Root
let container: HTMLDivElement
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }

const HOOKS = [
  { id: 1, name: 'veto-shell', event: 'pre_tool', tool_filter: 'shell_exec', command: 'exit 1', timeout_ms: 30000, enabled: 1 },
  { id: 2, name: 'watch-all', event: 'post_tool', tool_filter: '', command: 'exit 0', timeout_ms: 5000, enabled: 0 },
]

function setInput(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  root.render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <HooksPanel />
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
  mocked.mockImplementation(async (path: string) => {
    if (path === '/api/agents/hooks') return { hooks: HOOKS } as never
    throw new Error(`unexpected ${path}`)
  })
})
afterEach(() => { act(() => root.unmount()); container.remove() })

it('lists hooks with event and tool badges', async () => {
  render()
  await flush()
  expect(container.textContent).toContain('veto-shell')
  expect(container.textContent).toContain('Before tool (can veto)')
  expect(container.textContent).toContain('shell_exec')
  expect(container.textContent).toContain('watch-all')
  expect(container.textContent).toContain('After tool (observe)')
  expect(container.textContent).toContain('any tool')
})

it('creates a hook through the dialog', async () => {
  let posted: Record<string, unknown> = {}
  mocked.mockImplementation(async (path: string, options?: RequestInit) => {
    if (path === '/api/agents/hooks' && !options?.method) return { hooks: HOOKS } as never
    if (path === '/api/agents/hooks' && options?.method === 'POST') {
      posted = JSON.parse(options.body as string)
      return { hook: { id: 3 } } as never
    }
    throw new Error(`unexpected ${path}`)
  })
  render()
  await flush()
  const open = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('New hook')) as HTMLButtonElement
  await act(async () => { open.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  await act(async () => {
    // The dialog renders in a portal on document.body, outside the container.
    setInput(document.querySelector('#hook-name') as HTMLInputElement, 'lint-after-edit')
    setInput(document.querySelector('#hook-tool-filter') as HTMLInputElement, 'edit_file')
    setInput(document.querySelector('#hook-command') as HTMLInputElement, 'npm run lint')
  })
  await flush()
  const create = Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Create') as HTMLButtonElement
  await act(async () => { create.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  expect(posted).toMatchObject({
    name: 'lint-after-edit', event: 'pre_tool', toolFilter: 'edit_file', command: 'npm run lint',
  })
})

it('toggles a hook off', async () => {
  const calls: Array<{ path: string; options?: RequestInit }> = []
  mocked.mockImplementation(async (path: string, options?: RequestInit) => {
    calls.push({ path, options })
    if (path === '/api/agents/hooks' && !options?.method) return { hooks: HOOKS } as never
    if (path === '/api/agents/hooks/1' && options?.method === 'PATCH') return { hook: HOOKS[0] } as never
    throw new Error(`unexpected ${path}`)
  })
  render()
  await flush()
  const toggle = container.querySelector('[role="switch"][aria-label="Disable"]') as HTMLButtonElement
  await act(async () => { toggle.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  const patch = calls.find(c => c.path === '/api/agents/hooks/1')
  expect(patch).toBeTruthy()
  expect(JSON.parse(patch!.options!.body as string)).toEqual({ enabled: false })
})
