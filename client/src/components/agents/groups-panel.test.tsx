// @vitest-environment jsdom
// Teams panel: starts an auto-planned group, selects one to see tasks, the
// interleaved timeline, and the blackboard, and pins an operator note.
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@/i18n'
import { apiFetch } from '@/lib/api'
import { GroupsPanel } from './groups-panel'

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn(), getToken: () => null }))
// Native selects stand in for the Base UI listboxes so tests can pick modes.
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (v: string) => void; children: ReactNode }) => (
    <select value={value} onChange={e => onValueChange(e.target.value)}>{children}</select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => <option value={value}>{children}</option>,
}))

const mocked = vi.mocked(apiFetch)
let root: Root
let container: HTMLDivElement
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }

const GROUP = {
  id: 1, goal: 'Ship it', status: 'done', budget_tokens: null, tokens_used: 26,
  error: null, created_at: '', finished_at: '',
  tasks: [
    {
      id: 1, name: 'build', role: 'coder', goal: 'Build', tools: [], dependsOn: [],
      status: 'done', run_id: 5, attempts: 1, max_attempts: 2, result_summary: 'Built ok', error: null,
      steps: [
        { seq: 1, kind: 'tool_call', name: 'write_file', content: { arguments: { path: 'a.txt' } }, created_at: '2026-01-01T00:00:01Z' },
        { seq: 2, kind: 'tool_result', name: 'write_file', content: { result: 'wrote a.txt' }, created_at: '2026-01-01T00:00:02Z' },
      ],
    },
    {
      id: 2, name: 'check', role: 'reviewer', goal: 'Review', tools: [], dependsOn: [1],
      status: 'done', run_id: 6, attempts: 1, max_attempts: 2, result_summary: null, error: null,
      steps: [
        { seq: 1, kind: 'answer', name: null, content: { text: 'Looks good' }, created_at: '2026-01-01T00:00:03Z' },
      ],
    },
  ],
  blackboard: [{ key: 'api', value: 'rest', writerTaskId: 1 }],
  locks: [],
}

function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  root.render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <GroupsPanel />
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
    if (path === '/api/models') return [{ enabled: true, keyCount: 1 }] as never
    if (path === '/api/agents/groups?limit=20') return { groups: [] } as never
    throw new Error(`unexpected ${path}`)
  })
})
afterEach(() => { act(() => root.unmount()); container.remove() })

function setArea(el: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function setInput(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

it('starts an auto-planned team from the goal', async () => {
  const calls: Array<{ path: string; options?: RequestInit }> = []
  mocked.mockImplementation(async (path: string, options?: RequestInit) => {
    calls.push({ path, options })
    if (path === '/api/models') return [{ enabled: true, keyCount: 1 }] as never
    if (path === '/api/agents/groups?limit=20') return { groups: [] } as never
    if (path === '/api/agents/groups/1') return { ...GROUP, tasks: [], blackboard: [] } as never
    return { ...GROUP, tasks: [], blackboard: [] } as never
  })
  render()
  await flush()
  await act(async () => { setArea(container.querySelector('#group-goal') as HTMLTextAreaElement, 'Ship it') })
  await flush()
  const start = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Start team')) as HTMLButtonElement
  expect(start.disabled).toBe(false)
  await act(async () => { start.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  const post = calls.find(c => c.options?.method === 'POST')
  expect(post?.path).toBe('/api/agents/groups')
  expect(JSON.parse(String(post?.options?.body))).toMatchObject({ goal: 'Ship it', auto: true })
})

it('selects a team to see tasks, timeline, and blackboard', async () => {
  mocked.mockImplementation(async (path: string) => {
    if (path === '/api/models') return [{ enabled: true, keyCount: 1 }] as never
    if (path === '/api/agents/groups?limit=20') {
      return { groups: [{ ...GROUP, tasks: undefined, blackboard: undefined, locks: undefined, task_count: 2, done_count: 2 }] } as never
    }
    if (path === '/api/agents/groups/1') return GROUP as never
    throw new Error(`unexpected ${path}`)
  })
  render()
  await flush()
  const row = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Ship it')) as HTMLButtonElement
  await act(async () => { row.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  expect(container.textContent).toContain('build')
  expect(container.textContent).toContain('reviewer')
  expect(container.textContent).toContain('wrote a.txt')
  expect(container.textContent).toContain('Looks good')
  expect(container.textContent).toContain('api')
})

it('starts a hierarchical crew without seed tasks', async () => {
  const calls: Array<{ path: string; options?: RequestInit }> = []
  mocked.mockImplementation(async (path: string, options?: RequestInit) => {
    calls.push({ path, options })
    if (path === '/api/models') return [{ enabled: true, keyCount: 1 }] as never
    if (path === '/api/agents/groups?limit=20') return { groups: [] } as never
    if (path === '/api/agents/groups' && options?.method === 'POST') {
      return { id: 9, goal: 'Ship it', status: 'running', mode: 'hierarchical', tasks: [], blackboard: [] } as never
    }
    if (path === '/api/agents/groups/9') {
      return { id: 9, goal: 'Ship it', status: 'running', mode: 'hierarchical', manager_decisions: 1, tokens_used: 40, tasks: [], blackboard: [] } as never
    }
    throw new Error(`unexpected ${path}`)
  })
  render()
  await flush()
  // Planning mode -> manual, crew mode -> hierarchical, goal only (no tasks JSON needed).
  const selects = Array.from(container.querySelectorAll('select'))
  expect(selects).toHaveLength(2)
  await act(async () => {
    const goal = container.querySelector('#group-goal') as HTMLTextAreaElement
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!.call(goal, 'Ship it')
    goal.dispatchEvent(new Event('input', { bubbles: true }))
    const selectProto = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!
    selectProto.call(selects[0], 'manual')
    selects[0].dispatchEvent(new Event('change', { bubbles: true }))
    selectProto.call(selects[1], 'hierarchical')
    selects[1].dispatchEvent(new Event('change', { bubbles: true }))
  })
  await flush()
  expect(container.textContent).toContain('Seed tasks are optional')
  const startBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Start team')) as HTMLButtonElement
  expect(startBtn.disabled).toBe(false)
  await act(async () => { startBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  const post = calls.find(c => c.path === '/api/agents/groups' && c.options?.method === 'POST')
  expect(JSON.parse(String(post?.options?.body))).toMatchObject({ goal: 'Ship it', mode: 'hierarchical' })
  expect(JSON.parse(String(post?.options?.body))).not.toHaveProperty('tasks')
  expect(container.textContent).toContain('1 manager decisions')
})

it('starts a preset crew from a runbook', async () => {
  const calls: Array<{ path: string; options?: RequestInit }> = []
  mocked.mockImplementation(async (path: string, options?: RequestInit) => {
    calls.push({ path, options })
    if (path === '/api/models') return [{ enabled: true, keyCount: 1 }] as never
    if (path === '/api/agents/runbooks') {
      return { runbooks: [{ name: 'startup-mvp', description: 'Ship it' }] } as never
    }
    if (path === '/api/agents/groups?limit=20') return { groups: [] } as never
    if (path === '/api/agents/groups' && options?.method === 'POST') {
      return { id: 9, goal: 'Ship it', status: 'running', mode: 'dag', tasks: [], blackboard: [] } as never
    }
    if (path === '/api/agents/groups/9') {
      return { id: 9, goal: 'Ship it', status: 'running', mode: 'dag', tokens_used: 0, tasks: [], blackboard: [] } as never
    }
    throw new Error(`unexpected ${path}`)
  })
  render()
  await flush()
  const selects = Array.from(container.querySelectorAll('select'))
  const selectProto = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!
  await act(async () => {
    const goal = container.querySelector('#group-goal') as HTMLTextAreaElement
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!.call(goal, 'Ship it')
    goal.dispatchEvent(new Event('input', { bubbles: true }))
    selectProto.call(selects[0], 'preset')
    selects[0].dispatchEvent(new Event('change', { bubbles: true }))
  })
  await flush()
  expect(container.textContent).toContain('Runbook')
  const startBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Start team')) as HTMLButtonElement
  expect(startBtn.disabled).toBe(false)
  await act(async () => { startBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  const post = calls.find(c => c.path === '/api/agents/groups' && c.options?.method === 'POST')
  expect(JSON.parse(String(post?.options?.body))).toMatchObject({ goal: 'Ship it', preset: 'startup-mvp' })
})

it('shows task contracts and handoff outputs', async () => {
  const contracted = {
    ...GROUP,
    tasks: [
      {
        ...GROUP.tasks[0],
        expected_output: 'Working code.',
        inputs: [],
        handoff: { summary: 'Built ok', outputs: { 'api-shape': 'REST' }, expected_output: 'Working code.' },
        verdict: { pass: true, reason: 'All criteria met.', kind: 'llm_judge' },
        output_json: 1,
        output_file: 'out/result.json',
      },
      {
        ...GROUP.tasks[1],
        expected_output: 'A review.',
        inputs: [{ name: 'spec', from: 1 }],
        handoff: null,
      },
    ],
  }
  mocked.mockImplementation(async (path: string) => {
    if (path === '/api/models') return [{ enabled: true, keyCount: 1 }] as never
    if (path === '/api/agents/groups?limit=20') {
      return { groups: [{ ...contracted, tasks: undefined, blackboard: undefined, locks: undefined, task_count: 2, done_count: 2 }] } as never
    }
    if (path === '/api/agents/groups/1') return contracted as never
    throw new Error(`unexpected ${path}`)
  })
  render()
  await flush()
  const row = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Ship it')) as HTMLButtonElement
  await act(async () => { row.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  expect(container.textContent).toContain('Expects: Working code.')
  expect(container.textContent).toContain('← spec from build')
  expect(container.textContent).toContain('Handoff: api-shape')
  expect(container.textContent).toContain('QA: PASS — All criteria met.')
  expect(container.textContent).toContain('Output: JSON → out/result.json')
})

it('pins an operator note to the blackboard', async () => {
  const calls: Array<{ path: string; options?: RequestInit }> = []
  mocked.mockImplementation(async (path: string, options?: RequestInit) => {
    calls.push({ path, options })
    if (path === '/api/models') return [{ enabled: true, keyCount: 1 }] as never
    if (path === '/api/agents/groups?limit=20') {
      return { groups: [{ ...GROUP, status: 'running', tasks: undefined, blackboard: undefined, locks: undefined, task_count: 2, done_count: 0 }] } as never
    }
    if (path === '/api/agents/groups/1') return { ...GROUP, status: 'running' } as never
    if (path === '/api/agents/groups/1/blackboard') return GROUP as never
    throw new Error(`unexpected ${path}`)
  })
  render()
  await flush()
  const row = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Ship it')) as HTMLButtonElement
  await act(async () => { row.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  await act(async () => {
    setInput(container.querySelector('#group-note-key') as HTMLInputElement, 'direction')
    setInput(container.querySelector('#group-note-value') as HTMLInputElement, 'use tabs')
  })
  await flush()
  const pin = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Pin note')) as HTMLButtonElement
  await act(async () => { pin.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  const post = calls.find(c => c.path === '/api/agents/groups/1/blackboard')
  expect(JSON.parse(String(post?.options?.body))).toEqual({ key: 'direction', value: 'use tabs' })
})
