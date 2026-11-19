// @vitest-environment jsdom
// Agent runs panel: launcher form posts a run, history selects a run and
// renders its persisted steps, final answer, and status.
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@/i18n'
import { apiFetch } from '@/lib/api'
import { AgentRunsPanel } from './runs-panel'

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn(), getToken: () => null }))

const mocked = vi.mocked(apiFetch)
let root: Root
let container: HTMLDivElement
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }

const MODELS = [
  { modelId: 'llama-3.1-8b-instant', displayName: 'Llama 8B', enabled: true, keyCount: 1 },
]

const RUN = {
  id: 1,
  goal: 'What is 2 + 2?',
  model: 'auto',
  tools: ['calculator'],
  skills: [],
  status: 'done',
  final_answer: 'The answer is 4.',
  error: null,
  steps_used: 3,
  prompt_tokens: 10,
  completion_tokens: 5,
  plan_mode: 0,
  parent_run_id: null,
  auto_approve: 0,
  created_at: new Date().toISOString(),
  steps: [
    { seq: 1, kind: 'tool_call', label: 'calculator', content: { tool: 'calculator', args: '{"expression":"2 + 2"}' } },
    { seq: 2, kind: 'tool_result', label: 'calculator', content: { ok: true, result: '4' } },
    { seq: 3, kind: 'answer', label: 'final answer', content: { text: 'The answer is 4.' } },
  ],
}

function render(entry = '/agents') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  root.render(
    <MemoryRouter initialEntries={[entry]}>
      <QueryClientProvider client={client}>
        <I18nProvider>
          <AgentRunsPanel />
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
    if (path === '/api/settings/api-key') return { apiKey: 'u-key' } as never
    if (path === '/api/skills') return { skills: [{ name: 'planner', enabled: 1 }] } as never
    if (path === '/api/mcp/tools') return { tools: [] } as never
    if (path === '/api/agents/sessions?limit=30') return { sessions: [] } as never
    if (path.startsWith('/api/agents/runs')) return { runs: [] } as never
    throw new Error(`unexpected ${path}`)
  })
})
afterEach(() => { act(() => root.unmount()); container.remove() })

it('starts disabled and enables once a goal is typed', async () => {
  render()
  await flush()
  const startBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Start run')) as HTMLButtonElement
  expect(startBtn.disabled).toBe(true)
  const goal = container.querySelector('#agent-goal') as HTMLTextAreaElement
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!.call(goal, 'Do a thing')
    goal.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await flush()
  expect(startBtn.disabled).toBe(false)
})

it('posts the run and shows the empty history hint', async () => {
  mocked.mockImplementation(async (path: string, options?: RequestInit) => {
    if (path === '/api/models') return MODELS as never
    if (path === '/api/settings/api-key') return { apiKey: 'u-key' } as never
    if (path === '/api/skills') return { skills: [] } as never
    if (path === '/api/mcp/tools') return { tools: [] } as never
    if (path === '/api/agents/sessions?limit=30') return { sessions: [] } as never
    if (path === '/api/agents/runs' && options?.method === 'POST') return { ...RUN, id: 7 } as never
    if (path === '/api/agents/runs?limit=30') return { runs: [] } as never
    throw new Error(`unexpected ${path}`)
  })
  render()
  await flush()
  expect(container.textContent).toContain('No runs yet')
})

it('selects a finished run and renders steps plus the final answer', async () => {
  mocked.mockImplementation(async (path: string) => {
    if (path === '/api/models') return MODELS as never
    if (path === '/api/settings/api-key') return { apiKey: 'u-key' } as never
    if (path === '/api/skills') return { skills: [] } as never
    if (path === '/api/mcp/tools') return { tools: [] } as never
    if (path === '/api/agents/sessions?limit=30') return { sessions: [] } as never
    if (path === '/api/agents/runs?limit=30') return { runs: [RUN] } as never
    throw new Error(`unexpected ${path}`)
  })
  render()
  await flush()
  const row = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('What is 2 + 2?')) as HTMLButtonElement
  expect(row).toBeTruthy()
  await act(async () => { row.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  expect(container.textContent).toContain('The answer is 4.')
  expect(container.textContent).toContain('calculator')
  expect(container.textContent).toContain('Done')
})

it('renders verification check steps with pass/fail', async () => {
  const withCheck = {
    ...RUN,
    steps: [
      ...RUN.steps,
      { seq: 4, kind: 'check', label: 'test', content: { pass: true, command: 'npm run test', summary: '3 passed' } },
      { seq: 5, kind: 'check', label: 'lint', content: { pass: false, command: 'npm run lint', summary: 'error: no-unused-vars' } },
    ],
  }
  mocked.mockImplementation(async (path: string) => {
    if (path === '/api/models') return MODELS as never
    if (path === '/api/settings/api-key') return { apiKey: 'u-key' } as never
    if (path === '/api/skills') return { skills: [] } as never
    if (path === '/api/mcp/tools') return { tools: [] } as never
    if (path === '/api/agents/sessions?limit=30') return { sessions: [] } as never
    if (path === '/api/agents/runs?limit=30') return { runs: [withCheck] } as never
    throw new Error(`unexpected ${path}`)
  })
  render()
  await flush()
  const row = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('What is 2 + 2?')) as HTMLButtonElement
  await act(async () => { row.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  expect(container.textContent).toContain('PASS npm run test')
  expect(container.textContent).toContain('FAIL npm run lint')
})

it('opens the run from a notification deep link', async () => {
  mocked.mockImplementation(async (path: string) => {
    if (path === '/api/models') return MODELS as never
    if (path === '/api/skills') return { skills: [] } as never
    if (path === '/api/mcp/tools') return { tools: [] } as never
    if (path === '/api/settings/api-key') return { apiKey: 'u-key' } as never
    if (path === '/api/agents/sessions?limit=30') return { sessions: [] } as never
    if (path === '/api/agents/runs?limit=30') return { runs: [RUN] } as never
    throw new Error(`unexpected ${path}`)
  })
  render('/agents?tab=runs&run=1')
  await flush()
  expect(container.textContent).toContain('The answer is 4.')
})

it('adopts the session from a deep link and filters history to it', async () => {
  const seen: string[] = []
  mocked.mockImplementation(async (path: string) => {
    seen.push(path)
    if (path === '/api/models') return MODELS as never
    if (path === '/api/settings/api-key') return { apiKey: 'u-key' } as never
    if (path === '/api/skills') return { skills: [] } as never
    if (path === '/api/mcp/tools') return { tools: [] } as never
    if (path === '/api/agents/sessions?limit=30') {
      return { sessions: [{ id: 9, title: 'Linked', run_count: 1 }] } as never
    }
    if (path === '/api/agents/runs?limit=30&session=9') return { runs: [{ ...RUN, session_id: 9 }] } as never
    if (path === '/api/agents/runs?limit=30') return { runs: [] } as never
    throw new Error(`unexpected ${path}`)
  })
  render('/agents?tab=runs&session=9')
  await flush()
  expect(seen).toContain('/api/agents/runs?limit=30&session=9')
  expect(container.textContent).toContain('What is 2 + 2?')
})

it('lists checkpoints and restores one after confirmation', async () => {
  const calls: Array<{ path: string; method?: string }> = []
  mocked.mockImplementation(async (path: string, options?: RequestInit) => {
    calls.push({ path, method: options?.method })
    if (path === '/api/models') return MODELS as never
    if (path === '/api/settings/api-key') return { apiKey: 'u-key' } as never
    if (path === '/api/skills') return { skills: [] } as never
    if (path === '/api/mcp/tools') return { tools: [] } as never
    if (path === '/api/agents/sessions?limit=30') return { sessions: [] } as never
    if (path === '/api/agents/runs?limit=30') return { runs: [RUN] } as never
    if (path === '/api/agents/runs/1/checkpoints' && !options?.method) {
      return { checkpoints: [{ id: 5, run_id: 1, seq: 2, label: 'before write_file a.txt', created_at: new Date().toISOString() }] } as never
    }
    if (path === '/api/agents/checkpoints/5/restore' && options?.method === 'POST') {
      return { restored: 5, run: RUN } as never
    }
    throw new Error(`unexpected ${path}`)
  })
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
  try {
    render()
    await flush()
    const row = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('What is 2 + 2?')) as HTMLButtonElement
    await act(async () => { row.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await flush()
    expect(container.textContent).toContain('before write_file a.txt')
    const restoreBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Restore') as HTMLButtonElement
    expect(restoreBtn).toBeTruthy()
    expect(restoreBtn.disabled).toBe(false)
    await act(async () => { restoreBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await flush()
    expect(confirmSpy).toHaveBeenCalled()
    expect(calls).toContainEqual({ path: '/api/agents/checkpoints/5/restore', method: 'POST' })
    expect(container.textContent).toContain('Restored to snapshot #5')
  } finally {
    confirmSpy.mockRestore()
  }
})

it('posts planMode when the plan switch is on', async () => {
  let posted: Record<string, unknown> = {}
  mocked.mockImplementation(async (path: string, options?: RequestInit) => {
    if (path === '/api/models') return MODELS as never
    if (path === '/api/settings/api-key') return { apiKey: 'u-key' } as never
    if (path === '/api/skills') return { skills: [] } as never
    if (path === '/api/mcp/tools') return { tools: [] } as never
    if (path === '/api/agents/sessions?limit=30') return { sessions: [] } as never
    if (path === '/api/agents/runs' && options?.method === 'POST') {
      posted = JSON.parse(options.body as string)
      return { ...RUN, id: 7 } as never
    }
    if (path === '/api/agents/runs?limit=30' || path === '/api/agents/runs/7/checkpoints') {
      return { runs: [], checkpoints: [] } as never
    }
    throw new Error(`unexpected ${path}`)
  })
  render()
  await flush()
  const goal = container.querySelector('#agent-goal') as HTMLTextAreaElement
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!.call(goal, 'Plan this')
    goal.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const planSwitch = container.querySelector('#agent-plan-mode') as HTMLElement
  await act(async () => { planSwitch.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  const startBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Start run')) as HTMLButtonElement
  await act(async () => { startBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  expect(posted.planMode).toBe(true)
})

it('renders the plan step and planned badge', async () => {
  const planned = {
    ...RUN,
    plan_mode: 1,
    steps: [
      { seq: 1, kind: 'plan', label: 'plan', content: { text: '1. Calculate with calculator.' } },
      ...RUN.steps,
    ],
  }
  mocked.mockImplementation(async (path: string) => {
    if (path === '/api/models') return MODELS as never
    if (path === '/api/settings/api-key') return { apiKey: 'u-key' } as never
    if (path === '/api/skills') return { skills: [] } as never
    if (path === '/api/mcp/tools') return { tools: [] } as never
    if (path === '/api/agents/sessions?limit=30') return { sessions: [] } as never
    if (path === '/api/agents/runs?limit=30') return { runs: [planned] } as never
    if (path === '/api/agents/runs/1/checkpoints') return { checkpoints: [] } as never
    throw new Error(`unexpected ${path}`)
  })
  render()
  await flush()
  expect(container.textContent).toContain('planned')
  const row = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('What is 2 + 2?')) as HTMLButtonElement
  await act(async () => { row.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  expect(container.textContent).toContain('1. Calculate with calculator.')
})

it('shows the delegate tool and the child-of line', async () => {
  mocked.mockImplementation(async (path: string) => {
    if (path === '/api/models') return MODELS as never
    if (path === '/api/settings/api-key') return { apiKey: 'u-key' } as never
    if (path === '/api/skills') return { skills: [] } as never
    if (path === '/api/mcp/tools') return { tools: [] } as never
    if (path === '/api/agents/sessions?limit=30') return { sessions: [] } as never
    if (path === '/api/agents/runs?limit=30') return { runs: [{ ...RUN, id: 2, parent_run_id: 1 }] } as never
    if (path === '/api/agents/runs/2/checkpoints') return { checkpoints: [] } as never
    throw new Error(`unexpected ${path}`)
  })
  render()
  await flush()
  expect(container.textContent).toContain('delegate')
  const row = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('What is 2 + 2?')) as HTMLButtonElement
  await act(async () => { row.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  expect(container.textContent).toContain('child of run #1')
})

it('posts compactions and renders compact steps', async () => {
  let posted: Record<string, unknown> = {}
  mocked.mockImplementation(async (path: string, options?: RequestInit) => {
    if (path === '/api/models') return MODELS as never
    if (path === '/api/settings/api-key') return { apiKey: 'u-key' } as never
    if (path === '/api/skills') return { skills: [] } as never
    if (path === '/api/mcp/tools') return { tools: [] } as never
    if (path === '/api/agents/sessions?limit=30') return { sessions: [] } as never
    if (path === '/api/agents/runs' && options?.method === 'POST') {
      posted = JSON.parse(options.body as string)
      return { ...RUN, id: 7 } as never
    }
    if (path === '/api/agents/runs?limit=30') {
      return {
        runs: [{
          ...RUN,
          steps: [{ seq: 1, kind: 'compact', label: 'compact', content: { cycle: 1, trigger: 'pressure', summary: 'Did math.' } }],
        }],
      } as never
    }
    if (path === '/api/agents/runs/1/checkpoints') return { checkpoints: [] } as never
    throw new Error(`unexpected ${path}`)
  })
  render()
  await flush()
  const goal = container.querySelector('#agent-goal') as HTMLTextAreaElement
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!.call(goal, 'Long task')
    goal.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const compactions = container.querySelector('#agent-compactions') as HTMLInputElement
  expect(compactions.value).toBe('1')
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(compactions, '2')
    compactions.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const startBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Start run')) as HTMLButtonElement
  await act(async () => { startBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  expect(posted.compactions).toBe(2)
  const row = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('What is 2 + 2?')) as HTMLButtonElement
  await act(async () => { row.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  expect(container.textContent).toContain('context compacted (cycle 1, pressure)')
  expect(container.textContent).toContain('Did math.')
})

it('searches past runs from history', async () => {
  const calls: string[] = []
  mocked.mockImplementation(async (path: string) => {
    calls.push(path)
    if (path === '/api/models') return MODELS as never
    if (path === '/api/settings/api-key') return { apiKey: 'u-key' } as never
    if (path === '/api/skills') return { skills: [] } as never
    if (path === '/api/mcp/tools') return { tools: [] } as never
    if (path === '/api/agents/sessions?limit=30') return { sessions: [] } as never
    if (path === '/api/agents/runs?limit=30') return { runs: [RUN] } as never
    if (path.startsWith('/api/agents/runs/search')) {
      return { runs: [{ ...RUN, id: 9, goal: 'Fix login loop' }] } as never
    }
    if (path === '/api/agents/runs/9/checkpoints') return { checkpoints: [] } as never
    throw new Error(`unexpected ${path}`)
  })
  render()
  await flush()
  expect(container.textContent).toContain('What is 2 + 2?')
  const search = container.querySelector('input[aria-label="Search past runs…"]') as HTMLInputElement
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(search, 'login loop')
    search.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 350))
  })
  await flush()
  expect(calls.some(c => c.startsWith('/api/agents/runs/search?q=login%20loop'))).toBe(true)
  expect(container.textContent).toContain('Fix login loop')
  expect(container.textContent).not.toContain('What is 2 + 2?')
})

it('badges unattended runs as auto-approved', async () => {
  mocked.mockImplementation(async (path: string) => {
    if (path === '/api/models') return MODELS as never
    if (path === '/api/settings/api-key') return { apiKey: 'u-key' } as never
    if (path === '/api/skills') return { skills: [] } as never
    if (path === '/api/mcp/tools') return { tools: [] } as never
    if (path === '/api/agents/sessions?limit=30') return { sessions: [] } as never
    if (path === '/api/agents/runs?limit=30') return { runs: [{ ...RUN, auto_approve: 1 }] } as never
    throw new Error(`unexpected ${path}`)
  })
  render()
  await flush()
  expect(container.textContent).toContain('auto-approved')
})

it('disables restore while the run is live', async () => {
  mocked.mockImplementation(async (path: string) => {
    if (path === '/api/models') return MODELS as never
    if (path === '/api/settings/api-key') return { apiKey: 'u-key' } as never
    if (path === '/api/skills') return { skills: [] } as never
    if (path === '/api/mcp/tools') return { tools: [] } as never
    if (path === '/api/agents/sessions?limit=30') return { sessions: [] } as never
    if (path === '/api/agents/runs?limit=30') return { runs: [{ ...RUN, status: 'running' }] } as never
    if (path === '/api/agents/runs/1/checkpoints') {
      return { checkpoints: [{ id: 5, run_id: 1, seq: 2, label: 'x', created_at: new Date().toISOString() }] } as never
    }
    throw new Error(`unexpected ${path}`)
  })
  render()
  await flush()
  const row = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('What is 2 + 2?')) as HTMLButtonElement
  await act(async () => { row.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  const restoreBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Restore') as HTMLButtonElement
  expect(restoreBtn.disabled).toBe(true)
  expect(restoreBtn.title).toContain('Stop the run')
})
