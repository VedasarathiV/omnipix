// @vitest-environment jsdom
// Arena page: pick 2+ keyed models, run one prompt, see side-by-side answers.
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@/i18n'
import ArenaPage from './ArenaPage'
import { apiFetch } from '@/lib/api'

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }))

const MODELS = [
  { id: 1, platform: 'groq', modelId: 'model-a', displayName: 'Model A', enabled: true, keyCount: 1 },
  { id: 2, platform: 'cerebras', modelId: 'model-b', displayName: 'Model B', enabled: true, keyCount: 1 },
  { id: 3, platform: 'groq', modelId: 'model-nokey', displayName: 'No Key', enabled: true, keyCount: 0 },
]

let root: Root
let container: HTMLDivElement
beforeAll(() => { (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true })
beforeEach(() => {
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  vi.mocked(apiFetch).mockImplementation(async (url: string) => {
    if (url === '/api/models') return MODELS as never
    return { execution_id: 'test', results: [] } as never
  })
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks() })

async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  act(() => root.render(
    <QueryClientProvider client={client}>
      <I18nProvider initialLocale="en">
        <MemoryRouter initialEntries={['/models/arena']}>
          <Routes><Route path="/models/arena" element={<ArenaPage />} /></Routes>
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>
  ))
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

const optionButtons = () => [...container.querySelectorAll('button[aria-pressed]')]
const runButton = () => [...container.querySelectorAll('button')].find(b => b.textContent?.includes('Run arena'))
const click = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }

const typePrompt = (value: string) => {
  const prompt = container.querySelector('#arena-prompt') as HTMLTextAreaElement
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!
  act(() => {
    setter.call(prompt, value)
    prompt.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const typeSearch = (value: string) => {
  const input = container.querySelector('input[placeholder="Filter models…"]') as HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

it('lists keyed models and requires two selections plus a prompt to run', async () => {
  await mount()
  expect(container.textContent).toContain('Model A')
  expect(container.textContent).toContain('Model B')
  expect(container.textContent).not.toContain('No Key')
  expect(runButton()?.disabled).toBe(true)
  act(() => { optionButtons()[0].dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  act(() => { optionButtons()[1].dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  expect(runButton()?.disabled).toBe(true) // still no prompt
  typePrompt('hi')
  expect(runButton()?.disabled).toBe(false)
})

it('posts the run and renders both answers side by side', async () => {
  vi.mocked(apiFetch).mockImplementation(async (url: string) => {
    if (url === '/api/models') return MODELS as never
    return {
      execution_id: 'e1',
      results: [
        { model: 'model-a', displayName: 'Model A', platform: 'groq', ok: true, text: 'answer A', latencyMs: 120, promptTokens: 5, completionTokens: 2 },
        { model: 'model-b', displayName: 'Model B', platform: 'cerebras', ok: false, error: 'boom', latencyMs: 45 },
      ],
    } as never
  })
  await mount()
  act(() => { optionButtons()[0].dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  act(() => { optionButtons()[1].dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  // Controlled textarea: drive React's setter so onChange fires.
  const prompt = container.querySelector('#arena-prompt') as HTMLTextAreaElement
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!
  act(() => {
    setter.call(prompt, 'hi')
    prompt.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => { runButton()?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  expect(container.textContent).toContain('answer A')
  expect(container.textContent).toContain('boom')
  expect(container.textContent).toContain('120 ms')
  expect(container.textContent).toContain('↑5 ↓2')
  expect(container.textContent).toContain('Failed')
  const post = vi.mocked(apiFetch).mock.calls.find(c => c[0] === '/api/arena/run')
  expect(post).toBeTruthy()
  expect(JSON.parse((post![1] as { body: string }).body)).toMatchObject({
    models: ['model-a', 'model-b'],
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 1024,
  })
})

it('filters options by name, id, or platform', async () => {
  await mount()
  expect(optionButtons()).toHaveLength(2)
  typeSearch('cerebras')
  expect(container.textContent).not.toContain('Model A')
  expect(container.textContent).toContain('Model B')
  typeSearch('Model A')
  expect(container.textContent).toContain('Model A')
  expect(container.textContent).not.toContain('Model B')
  typeSearch('model-b')
  expect(container.textContent).not.toContain('Model A')
  expect(container.textContent).toContain('Model B')
  typeSearch('')
  expect(optionButtons()).toHaveLength(2)
})

it('deselects on a second click', async () => {
  await mount()
  click(optionButtons()[0])
  expect(optionButtons()[0].getAttribute('aria-pressed')).toBe('true')
  click(optionButtons()[0])
  expect(optionButtons()[0].getAttribute('aria-pressed')).toBe('false')
  expect(container.textContent).toContain('Models (0/6)')
})

it('caps selection at six models', async () => {
  const many = Array.from({ length: 7 }, (_, i) => (
    { id: 10 + i, platform: 'groq', modelId: `model-${i}`, displayName: `Model ${i}`, enabled: true, keyCount: 1 }
  ))
  vi.mocked(apiFetch).mockImplementation(async (url: string) => {
    if (url === '/api/models') return many as never
    return { execution_id: 'test', results: [] } as never
  })
  await mount()
  expect(optionButtons()).toHaveLength(7)
  for (let i = 0; i < 6; i++) click(optionButtons()[i])
  expect(container.textContent).toContain('Models (6/6)')
  expect((optionButtons()[6] as HTMLButtonElement).disabled).toBe(true)
})

it('shows skeletons while loading, not the empty state', async () => {
  vi.mocked(apiFetch).mockImplementation(async (url: string) => {
    if (url === '/api/models') return new Promise(() => {}) as never
    return { execution_id: 'test', results: [] } as never
  })
  await mount()
  expect(optionButtons()).toHaveLength(0)
  expect(container.textContent).not.toContain('No keyed models yet')
  expect(runButton()?.disabled).toBe(true)
})

it('shows the empty state when nothing is keyed', async () => {
  vi.mocked(apiFetch).mockImplementation(async (url: string) => {
    if (url === '/api/models') return [] as never
    return { execution_id: 'test', results: [] } as never
  })
  await mount()
  expect(container.textContent).toContain('No keyed models yet')
  expect(runButton()?.disabled).toBe(true)
})

it('shows the run error inline', async () => {
  vi.mocked(apiFetch).mockImplementation(async (url: string) => {
    if (url === '/api/models') return MODELS as never
    throw new Error('gateway down')
  })
  await mount()
  click(optionButtons()[0])
  click(optionButtons()[1])
  typePrompt('hi')
  await act(async () => { runButton()?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  expect(container.textContent).toContain('gateway down')
})

it('disables the run button and relabels it while racing', async () => {
  let release!: (value: unknown) => void
  vi.mocked(apiFetch).mockImplementation(async (url: string) => {
    if (url === '/api/models') return MODELS as never
    return new Promise(resolve => { release = resolve }) as never
  })
  await mount()
  click(optionButtons()[0])
  click(optionButtons()[1])
  typePrompt('hi')
  const button = runButton() as HTMLButtonElement
  await act(async () => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush() // let the mutation's pending state land; the run promise is still held
  expect(button.disabled).toBe(true)
  expect(button.textContent).toContain('Racing…')
  await act(async () => { release({ execution_id: 'e', results: [] }) })
  await flush()
  expect(button.disabled).toBe(false)
  expect(button.textContent).toContain('Run arena')
})
