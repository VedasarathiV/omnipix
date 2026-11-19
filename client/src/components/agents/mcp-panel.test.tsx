// @vitest-environment jsdom
// MCP servers panel: lists servers with tool counts and errors, creates one
// through the dialog, and tests the connection.
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@/i18n'
import { apiFetch } from '@/lib/api'
import { McpPanel } from './mcp-panel'

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn(), getToken: () => null }))

const mocked = vi.mocked(apiFetch)
let root: Root
let container: HTMLDivElement
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }

const SERVERS = [
  {
    id: 1, name: 'fs', transport: 'stdio', command: 'npx', args: ['-y', 'x'], url: '',
    enabled: 1, tool_count: 3, last_error: null, last_seen_at: null, created_at: '',
  },
  {
    id: 2, name: 'dead', transport: 'http', command: '', args: [], url: 'https://x.test/mcp',
    enabled: 1, tool_count: null, last_error: 'connection refused', last_seen_at: null, created_at: '',
  },
]

function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  root.render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <McpPanel />
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
  mocked.mockResolvedValue({ servers: SERVERS } as never)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

function setInput(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

it('lists servers with tool counts and errors', async () => {
  render()
  await flush()
  expect(container.textContent).toContain('fs')
  expect(container.textContent).toContain('3 tools')
  expect(container.textContent).toContain('connection refused')
})

it('creates a stdio server through the dialog', async () => {
  const calls: Array<{ path: string; options?: RequestInit }> = []
  mocked.mockImplementation(async (path: string, options?: RequestInit) => {
    calls.push({ path, options })
    if (!options?.method) return { servers: SERVERS } as never
    return { server: SERVERS[0] } as never
  })
  render()
  await flush()
  const open = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('New server')) as HTMLButtonElement
  await act(async () => { open.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  await act(async () => {
    setInput(document.querySelector('#mcp-name') as HTMLInputElement, 'git')
    setInput(document.querySelector('#mcp-command') as HTMLInputElement, 'mcp-git')
  })
  await flush()
  const create = Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Create') as HTMLButtonElement
  expect(create.disabled).toBe(false)
  await act(async () => { create.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  const post = calls.find(c => c.options?.method === 'POST')
  expect(post?.path).toBe('/api/mcp/servers')
  expect(JSON.parse(String(post?.options?.body))).toMatchObject({ name: 'git', transport: 'stdio', command: 'mcp-git' })
})

it('tests a server and reports the tools', async () => {
  mocked.mockImplementation(async (_path: string, options?: RequestInit) => {
    if (!options?.method) return { servers: SERVERS } as never
    return { tools: [{ name: 'read' }, { name: 'write' }] } as never
  })
  render()
  await flush()
  const testBtn = container.querySelector('button[aria-label="Test"]') as HTMLButtonElement
  await act(async () => { testBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  expect(container.textContent).toContain('Connected.')
  expect(container.textContent).toContain('read')
})
