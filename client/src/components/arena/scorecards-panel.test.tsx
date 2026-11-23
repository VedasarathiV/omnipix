// @vitest-environment jsdom
// Scorecards panel: ranked per-model pass rates with progress bars,
// run counts, and per-suite breakdowns.
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@/i18n'
import { apiFetch } from '@/lib/api'
import { ScorecardsPanel } from './scorecards-panel'

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
        <ScorecardsPanel />
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
})
afterEach(() => { act(() => root.unmount()); container.remove() })

it('shows the empty hint with no finished evals', async () => {
  mocked.mockResolvedValue({ scorecards: [] } as never)
  render()
  await flush()
  expect(container.textContent).toContain('No finished evaluations yet')
})

it('ranks models by pass rate with bars and suite splits', async () => {
  mocked.mockResolvedValue({
    scorecards: [
      {
        model: 'model-a', displayName: 'Model A', platform: 'groq',
        runs: 2, passed: 9, total: 10, passRate: 0.9,
        suites: { 'safety-basics': { runs: 2, passed: 9, total: 10 } },
        lastRunAt: new Date().toISOString(),
      },
      {
        model: 'model-b', displayName: 'Model B', platform: 'cerebras',
        runs: 1, passed: 2, total: 10, passRate: 0.2,
        suites: { 'safety-basics': { runs: 1, passed: 2, total: 10 } },
        lastRunAt: new Date().toISOString(),
      },
    ],
  } as never)
  render()
  await flush()
  const text = container.textContent ?? ''
  expect(text.indexOf('Model A')).toBeLessThan(text.indexOf('Model B'))
  expect(text).toContain('90.0%')
  expect(text).toContain('safety-basics 9/10')
  const bars = container.querySelectorAll('[role="progressbar"]')
  expect(bars).toHaveLength(2)
  expect(bars[0].getAttribute('aria-valuenow')).toBe('90')
})
