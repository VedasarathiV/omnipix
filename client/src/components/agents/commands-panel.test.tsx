// @vitest-environment jsdom
// Commands panel: lists slash commands, creates one through the dialog, and
// deletes with confirmation.
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@/i18n'
import { apiFetch } from '@/lib/api'
import { CommandsPanel } from './commands-panel'

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn(), getToken: () => null }))

const mocked = vi.mocked(apiFetch)
let root: Root
let container: HTMLDivElement
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }

const COMMANDS = [
  { name: 'review-pr', description: 'Review a pull request', agent: null, model: null, template: 'Review: $ARGUMENTS' },
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
        <CommandsPanel />
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
    if (path === '/api/commands') return { commands: COMMANDS } as never
    throw new Error(`unexpected ${path}`)
  })
})
afterEach(() => { act(() => root.unmount()); container.remove() })

it('lists commands with their slash names', async () => {
  render()
  await flush()
  expect(container.textContent).toContain('/review-pr')
  expect(container.textContent).toContain('Review a pull request')
})

it('creates a command through the dialog', async () => {
  const calls: Array<{ path: string; options?: RequestInit }> = []
  mocked.mockImplementation(async (path: string, options?: RequestInit) => {
    calls.push({ path, options })
    if (path === '/api/commands' && !options?.method) return { commands: COMMANDS } as never
    if (path === '/api/commands' && options?.method === 'POST') return { command: { name: 'ship' } } as never
    throw new Error(`unexpected ${path}`)
  })
  render()
  await flush()
  const open = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('New command')) as HTMLButtonElement
  await act(async () => { open.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  await act(async () => {
    setInput(document.querySelector('#command-name') as HTMLInputElement, 'ship')
    setInput(document.querySelector('#command-desc') as HTMLInputElement, 'Ship it')
    setInput(document.querySelector('#command-template') as HTMLTextAreaElement, 'Ship: $ARGUMENTS')
  })
  await flush()
  const create = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Create') as HTMLButtonElement
  expect(create.disabled).toBe(false)
  await act(async () => { create.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  const post = calls.find(c => c.path === '/api/commands' && c.options?.method === 'POST')
  expect(JSON.parse(String(post?.options?.body))).toMatchObject({ name: 'ship', description: 'Ship it', template: 'Ship: $ARGUMENTS' })
})

it('deletes a command after confirmation', async () => {
  const calls: Array<{ path: string; method?: string }> = []
  mocked.mockImplementation(async (path: string, options?: RequestInit) => {
    calls.push({ path, method: options?.method })
    if (path === '/api/commands' && !options?.method) return { commands: COMMANDS } as never
    if (path === '/api/commands/review-pr' && options?.method === 'DELETE') return { deleted: 'review-pr' } as never
    throw new Error(`unexpected ${path}`)
  })
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
  try {
    render()
    await flush()
    const del = container.querySelector('button[aria-label="Delete review-pr"]') as HTMLButtonElement
    await act(async () => { del.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await flush()
    expect(confirmSpy).toHaveBeenCalled()
    expect(calls).toContainEqual({ path: '/api/commands/review-pr', method: 'DELETE' })
  } finally {
    confirmSpy.mockRestore()
  }
})
