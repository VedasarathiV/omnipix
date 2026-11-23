// @vitest-environment jsdom
// Evals panel: pick a suite + models, start an eval, expand history rows to
// see per-model pass counts and per-item check details.
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@/i18n'
import { apiFetch } from '@/lib/api'
import { EvalsPanel } from './evals-panel'

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn(), getToken: () => null }))

const mocked = vi.mocked(apiFetch)
let root: Root
let container: HTMLDivElement
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }

const MODELS = [
  { id: 1, platform: 'groq', modelId: 'model-a', displayName: 'Model A', enabled: true, keyCount: 1 },
]

const SUITES = [
  {
    id: 1, name: 'safety-basics', description: 'Safety checks.', builtin: 1,
    items: [{ id: 'x', prompt: 'Do harm?', checks: [{ type: 'refuses' }] }],
  },
]

const EVAL = {
  id: 4, suite: 'safety-basics', models: ['model-a'], status: 'done', error: null,
  created_at: new Date().toISOString(), finished_at: new Date().toISOString(),
  results: [{
    model: 'model-a', displayName: 'Model A', platform: 'groq', passed: 1, total: 1,
    items: [{ id: 'x', pass: true, text: "I can't help.", latencyMs: 120, checks: [{ type: 'refuses', pass: true, detail: 'refusal phrase: "i can\'t help"' }] }],
  }],
}

function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  root.render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <I18nProvider>
          <EvalsPanel />
        </I18nProvider>
      </QueryClientProvider>
    </MemoryRouter>,
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
    if (path === '/api/models') return MODELS as never
    if (path === '/api/arena/suites') return { suites: SUITES } as never
    if (path === '/api/arena/evals?limit=20') return { evals: [] } as never
    throw new Error(`unexpected ${path}`)
  })
})
afterEach(() => { act(() => root.unmount()); container.remove() })

it('starts disabled until a suite and model are chosen', async () => {
  render()
  await flush()
  const run = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Run evaluation')) as HTMLButtonElement
  expect(run.disabled).toBe(true)
  expect(container.textContent).toContain('No evaluations yet')
})

it('expands a finished run to per-item check details', async () => {
  mocked.mockImplementation(async (path: string) => {
    if (path === '/api/models') return MODELS as never
    if (path === '/api/arena/suites') return { suites: SUITES } as never
    if (path === '/api/arena/evals?limit=20') return { evals: [EVAL] } as never
    throw new Error(`unexpected ${path}`)
  })
  render()
  await flush()
  expect(container.textContent).toContain('1/1 passed')
  const row = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('safety-basics')) as HTMLButtonElement
  await act(async () => { row.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  expect(container.textContent).toContain('Model A')
  expect(container.textContent).toContain('refusal phrase')
  expect(container.textContent).toContain('120 ms')
})

it('links agent items to their run trace', async () => {
  const agentEval = {
    ...EVAL,
    results: [{
      ...EVAL.results[0],
      items: [{
        id: 'world', pass: true, text: 'Wrote it.', latencyMs: 9000, agentRunId: 42, agentStatus: 'done',
        checks: [{ type: 'shell', pass: true, detail: 'test world.txt: exit 0' }],
      }],
    }],
  }
  mocked.mockImplementation(async (path: string) => {
    if (path === '/api/models') return MODELS as never
    if (path === '/api/arena/suites') return { suites: SUITES } as never
    if (path === '/api/arena/evals?limit=20') return { evals: [agentEval] } as never
    throw new Error(`unexpected ${path}`)
  })
  render()
  await flush()
  const row = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('safety-basics')) as HTMLButtonElement
  await act(async () => { row.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  expect(container.textContent).toContain('test world.txt: exit 0')
  const link = Array.from(container.querySelectorAll('a')).find(a => a.textContent?.includes('agent #42')) as HTMLAnchorElement
  expect(link).toBeTruthy()
  expect(link.getAttribute('href')).toBe('/agents?tab=runs&run=42')
})
