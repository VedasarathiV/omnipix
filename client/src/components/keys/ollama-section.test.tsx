// @vitest-environment jsdom
// Local Ollama section on the Keys page: status line, model list, Connect and
// Pull actions against /api/local/ollama.
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@/i18n'
import { apiFetch } from '@/lib/api'
import { OllamaSection } from './ollama-section'

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }))

let root: Root
let container: HTMLDivElement
let client: QueryClient
let status: { running: boolean; version: string | null; models: { name: string; size: number | null }[]; connected: boolean; registeredModels: string[] }

beforeAll(() => { (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true })
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  status = {
    running: true, version: '0.1.2',
    models: [{ name: 'qwen2.5-coder:0.5b', size: 397_000_000 }, { name: 'tiny', size: null }],
    connected: true, registeredModels: ['qwen2.5-coder:0.5b'],
  }
  vi.mocked(apiFetch).mockReset().mockImplementation(async (path: string) => {
    if (path === '/api/local/ollama') return { ollama: status }
    if (path === '/api/local/ollama/connect') return { success: true, models: ['qwen2.5-coder:0.5b'], created: [] }
    if (path === '/api/local/ollama/pull') return { success: true, name: 'x', bytes: 1 }
    return {}
  })
})
afterEach(() => { act(() => root.unmount()); client.clear(); container.remove() })

async function flush() { for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }
async function mount() {
  act(() => root.render(
    <QueryClientProvider client={client}><I18nProvider initialLocale="en"><OllamaSection /></I18nProvider></QueryClientProvider>,
  ))
  await flush()
}
const section = () => container.querySelector('[data-testid="ollama-section"]')
const button = (label: string) => [...container.querySelectorAll('button')].find(b => b.textContent === label) as HTMLButtonElement | undefined

it('shows the running version, the model list and the connected count', async () => {
  await mount()
  expect(section()?.textContent).toContain('Ollama 0.1.2 is running')
  expect(section()?.textContent).toContain('qwen2.5-coder:0.5b')
  expect(section()?.textContent).toContain('378.6 MB')
  expect(section()?.textContent).toContain('1 models connected')
})

it('connect posts and refreshes the status', async () => {
  await mount()
  await act(async () => { button('Connect')?.click() })
  await flush()
  expect(vi.mocked(apiFetch)).toHaveBeenCalledWith('/api/local/ollama/connect', { method: 'POST' })
})

it('pull sends the trimmed model name and clears the input', async () => {
  await mount()
  const input = container.querySelector('input') as HTMLInputElement
  await act(async () => {
    input.focus()
    // React 19: set the native value then bubble an input event.
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, '  llama3.2  ')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => { button('Pull')?.click() })
  await flush()
  expect(vi.mocked(apiFetch)).toHaveBeenCalledWith('/api/local/ollama/pull', {
    method: 'POST', body: JSON.stringify({ model: 'llama3.2' }),
  })
  expect((container.querySelector('input') as HTMLInputElement).value).toBe('')
})

it('tells the user to start the daemon when it is down, with actions disabled', async () => {
  status = { running: false, version: null, models: [], connected: false, registeredModels: [] }
  await mount()
  expect(section()?.textContent).toContain('Ollama is not running')
  expect(button('Connect')?.disabled).toBe(true)
  expect(button('Pull')?.disabled).toBe(true)
})
