// @vitest-environment jsdom
// Assistant tab panels: memories list with scores and add form; automations
// list with review badges and manual run.
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@/i18n'
import { apiFetch } from '@/lib/api'
import { AutomationsPanel, DocsPanel, MemoryPanel, ScansPanel } from './assistant-panels'

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn(), getToken: () => null }))

const mocked = vi.mocked(apiFetch)
let root: Root
let container: HTMLDivElement
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }

function render(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  root.render(
    <QueryClientProvider client={client}>
      <I18nProvider>{node}</I18nProvider>
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

function setInput(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

it('lists memories and adds one', async () => {
  const calls: Array<{ path: string; options?: RequestInit }> = []
  mocked.mockImplementation(async (path: string, options?: RequestInit) => {
    calls.push({ path, options })
    if (!options?.method) {
      return { memories: [{ id: 1, scope: 'user', project_key: '', key: 'style', value: 'tabs', importance: 0.9, score: 0.85 }] } as never
    }
    return { memory: {}, redactions: 0 } as never
  })
  render(<MemoryPanel />)
  await flush()
  expect(container.textContent).toContain('style')
  expect(container.textContent).toContain('0.85')
  await act(async () => {
    setInput(container.querySelector('#memory-key') as HTMLInputElement, 'tz')
    setInput(container.querySelector('#memory-value') as HTMLInputElement, 'UTC+8')
  })
  await flush()
  const add = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Remember')) as HTMLButtonElement
  await act(async () => { add.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  const post = calls.find(c => c.options?.method === 'POST')
  expect(post?.path).toBe('/api/memories')
  expect(JSON.parse(String(post?.options?.body))).toMatchObject({ key: 'tz', scope: 'user' })
})

it('lists automations with review state and runs one manually', async () => {
  const calls: Array<{ path: string; options?: RequestInit }> = []
  mocked.mockImplementation(async (path: string, options?: RequestInit) => {
    calls.push({ path, options })
    if (!options?.method) {
      return {
        automations: [
          { id: 1, name: 'brief', goal: 'Brief me', schedule: '0 9 * * *', model: 'auto', enabled: 1, reviewed: 1, last_run_id: 7, last_status: 'done', last_run_at: null, next_run_at: null },
          { id: 2, name: 'draft', goal: 'Draft', schedule: '', model: 'auto', enabled: 1, reviewed: 0, last_run_id: null, last_status: null, last_run_at: null, next_run_at: null },
        ],
      } as never
    }
    return { run_id: 9 } as never
  })
  render(<AutomationsPanel />)
  await flush()
  expect(container.textContent).toContain('brief')
  expect(container.textContent).toContain('Reviewed')
  expect(container.textContent).toContain('Needs a manual run first')
  const runButtons = Array.from(container.querySelectorAll('button[aria-label="Run now"]'))
  expect(runButtons).toHaveLength(2)
  await act(async () => { (runButtons[0] as HTMLButtonElement).dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  expect(calls.some(c => c.path === '/api/automations/1/run' && c.options?.method === 'POST')).toBe(true)
})

it('lists scans, expands findings, and scans on demand', async () => {
  const calls: Array<{ path: string; options?: RequestInit }> = []
  mocked.mockImplementation(async (path: string, options?: RequestInit) => {
    calls.push({ path, options })
    if (path === '/api/agents/scans' && !options?.method) {
      return {
        scans: [{ id: 3, trigger: 'scheduled', status: 'done', workspace_count: 2, finding_count: 1, new_count: 1, error: null, finished_at: new Date().toISOString() }],
        settings: { enabled: true, schedule: '0 3 * * *', nextRunAt: null },
      } as never
    }
    if (path === '/api/agents/scans/3') {
      return {
        scan: { id: 3 },
        findings: [{ id: 9, scan_id: 3, workspace: 'run-1', pattern: 'aws-key', severity: 'high', file: 'a.js', line: 1, excerpt: 'const k = "AKIA..."' }],
      } as never
    }
    if (path === '/api/agents/scans' && options?.method === 'POST') return { scan: { id: 4 }, findings: [] } as never
    throw new Error(`unexpected ${path}`)
  })
  render(<ScansPanel />)
  await flush()
  expect(container.textContent).toContain('2 workspaces')
  expect(container.textContent).toContain('1 findings')
  expect(container.textContent).toContain('1 new')
  const row = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('#3')) as HTMLButtonElement
  await act(async () => { row.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  expect(container.textContent).toContain('run-1/a.js:1')
  expect(container.textContent).toContain('aws-key')
  const scanNow = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Scan now') as HTMLButtonElement
  await act(async () => { scanNow.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  expect(calls.some(c => c.path === '/api/agents/scans' && c.options?.method === 'POST')).toBe(true)
})

it('saves a schedule and toggles the job', async () => {
  const calls: Array<{ path: string; options?: RequestInit }> = []
  mocked.mockImplementation(async (path: string, options?: RequestInit) => {
    calls.push({ path, options })
    if (path === '/api/agents/scans' && !options?.method) {
      return { scans: [], settings: { enabled: true, schedule: '0 3 * * *', nextRunAt: null } } as never
    }
    if (path === '/api/agents/scans-settings' && options?.method === 'PATCH') {
      return { settings: { enabled: true, schedule: '0 3 * * *', nextRunAt: null } } as never
    }
    throw new Error(`unexpected ${path}`)
  })
  render(<ScansPanel />)
  await flush()
  expect(container.textContent).toContain('No scans yet.')
  await act(async () => {
    setInput(container.querySelector('input[aria-label="Schedule (cron)"]') as HTMLInputElement, '*/30 * * * *')
  })
  await flush()
  const save = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Save') as HTMLButtonElement
  await act(async () => { save.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  expect(calls.some(c => c.path === '/api/agents/scans-settings' && String(c.options?.body).includes('*/30 * * * *'))).toBe(true)
  const toggle = container.querySelector('[role="switch"]') as HTMLButtonElement
  await act(async () => { toggle.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  expect(calls.some(c => c.path === '/api/agents/scans-settings' && String(c.options?.body).includes('"enabled":false'))).toBe(true)
})

it('ingests a doc and deletes it', async () => {
  const calls: Array<{ path: string; options?: RequestInit }> = []
  mocked.mockImplementation(async (path: string, options?: RequestInit) => {
    calls.push({ path, options })
    if (path === '/api/memories/docs' && !options?.method) {
      return { docs: [{ project_key: 'acme', source_url: 'https://x.test/g', title: 'Guide', chunks: 4, updated_at: '' }] } as never
    }
    if (path === '/api/memories/ingest' && options?.method === 'POST') return { doc: { chunks: 4 } } as never
    if (path.startsWith('/api/memories/docs?') && options?.method === 'DELETE') return { deleted: 'x', chunks: 4 } as never
    throw new Error(`unexpected ${path}`)
  })
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
  try {
    render(<DocsPanel />)
    await flush()
    expect(container.textContent).toContain('Guide')
    expect(container.textContent).toContain('4 chunks')
    await act(async () => {
      setInput(container.querySelector('#docs-url') as HTMLInputElement, 'https://x.test/g')
      setInput(container.querySelector('#docs-project') as HTMLInputElement, 'acme')
    })
    await flush()
    const ingest = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Ingest') as HTMLButtonElement
    expect(ingest.disabled).toBe(false)
    await act(async () => { ingest.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await flush()
    expect(calls.some(c => c.path === '/api/memories/ingest' && String(c.options?.body).includes('https://x.test/g'))).toBe(true)
    const del = container.querySelector('button[aria-label="Delete doc"]') as HTMLButtonElement
    await act(async () => { del.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await flush()
    expect(confirmSpy).toHaveBeenCalled()
    expect(calls.some(c => c.path.startsWith('/api/memories/docs?') && c.options?.method === 'DELETE')).toBe(true)
  } finally {
    confirmSpy.mockRestore()
  }
})
