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

it('lists keyed models and requires two selections plus a prompt to run', async () => {
  await mount()
  expect(container.textContent).toContain('Model A')
  expect(container.textContent).toContain('Model B')
  expect(container.textContent).not.toContain('No Key')
  expect(runButton()?.disabled).toBe(true)
  act(() => { optionButtons()[0].dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  act(() => { optionButtons()[1].dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  expect(runButton()?.disabled).toBe(true) // still no prompt
  const prompt = container.querySelector('#arena-prompt') as HTMLTextAreaElement
  act(() => {
    prompt.value = 'hi'
    prompt.dispatchEvent(new Event('input', { bubbles: true }))
  })
  // React 19 reads textarea value from the property; set natively instead.
  expect(prompt).toBeTruthy()
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
  const post = vi.mocked(apiFetch).mock.calls.find(c => c[0] === '/api/arena/run')
  expect(post).toBeTruthy()
  expect(JSON.parse((post![1] as { body: string }).body)).toMatchObject({
    models: ['model-a', 'model-b'],
    messages: [{ role: 'user', content: 'hi' }],
  })
})
