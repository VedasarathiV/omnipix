// @vitest-environment jsdom
// Approvals inbox: lists pending requests, expands one to show arguments and
// the diff, and posts approve/deny decisions.
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@/i18n'
import { apiFetch } from '@/lib/api'
import { ApprovalsPanel } from './approvals-panel'
import { parseDiff } from './diff-parse'

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn(), getToken: () => null }))

const mocked = vi.mocked(apiFetch)
let root: Root
let container: HTMLDivElement
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }

const APPROVALS = [
  {
    id: 3, run_id: 7, seq: 2, tool: 'calculator', args_json: '{"expression":"2 + 2"}',
    risk: 'write', summary: 'Calculate 2 + 2', diff_text: null, status: 'pending',
    created_at: new Date().toISOString(), decided_at: null,
  },
  {
    id: 2, run_id: 7, seq: 1, tool: 'fetch_url', args_json: '{"url":"https://x.test"}',
    risk: 'read', summary: 'Fetch https://x.test', diff_text: null, status: 'approved',
    created_at: new Date().toISOString(), decided_at: new Date().toISOString(),
  },
]

function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  root.render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <ApprovalsPanel />
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
  mocked.mockResolvedValue({ approvals: APPROVALS } as never)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

it('shows pending requests and hides decided ones by default', async () => {
  render()
  await flush()
  expect(container.textContent).toContain('Calculate 2 + 2')
  expect(container.textContent).not.toContain('Fetch https://x.test')
  const toggle = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Show decided')) as HTMLButtonElement
  await act(async () => { toggle.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  expect(container.textContent).toContain('Fetch https://x.test')
})

it('expands a request and posts the decision', async () => {
  const calls: Array<{ path: string; options?: RequestInit }> = []
  mocked.mockImplementation(async (path: string, options?: RequestInit) => {
    calls.push({ path, options })
    return { approvals: APPROVALS } as never
  })
  render()
  await flush()
  const row = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Calculate 2 + 2')) as HTMLButtonElement
  await act(async () => { row.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  expect(container.textContent).toContain('2 + 2')
  expect(container.textContent).toContain('Run #7')
  const approve = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Approve')) as HTMLButtonElement
  await act(async () => { approve.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  const post = calls.find(c => c.options?.method === 'POST')
  expect(post?.path).toBe('/api/agents/approvals/3/decide')
  expect(String(post?.options?.body)).toContain('"approved":true')
})

it('parses unified diffs into add/del/context lines', () => {
  const lines = parseDiff('@@ -1,2 +1,2 @@\n ctx\n-old\n+new')
  expect(lines.map(l => l.kind)).toEqual(['hunk', 'context', 'del', 'add'])
  expect(lines[3].text).toBe('new')
})

it('scopes a git_commit approval to the checked files', async () => {
  const COMMIT = {
    id: 9, run_id: 7, seq: 4, tool: 'git_commit', args_json: '{"message":"wip"}',
    risk: 'write', summary: 'Commit: wip', diff_text: 'a.txt\n', status: 'pending',
    created_at: new Date().toISOString(), decided_at: null,
  }
  const calls: Array<{ path: string; options?: RequestInit }> = []
  mocked.mockImplementation(async (path: string, options?: RequestInit) => {
    calls.push({ path, options })
    if (path === '/api/agents/approvals?limit=50') return { approvals: [COMMIT] } as never
    if (path === '/api/agents/runs/7/git/status') {
      return { isRepo: true, branch: 'feat', files: [{ path: 'a.txt', status: 'M' }, { path: 'b.txt', status: 'M' }] } as never
    }
    if (path === '/api/agents/approvals/9/decide') return { approval: COMMIT, run: {} } as never
    return {} as never
  })
  render()
  await flush()
  const row = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Commit: wip')) as HTMLButtonElement
  await act(async () => { row.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  expect(container.textContent).toContain('Files in this commit')
  // Uncheck b.txt, approve the narrowed scope.
  const boxes = Array.from(container.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[]
  expect(boxes).toHaveLength(2)
  await act(async () => { boxes[1].click() })
  const scoped = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Approve selected (1)')) as HTMLButtonElement
  expect(scoped).toBeTruthy()
  await act(async () => { scoped.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  const post = calls.find(c => c.path === '/api/agents/approvals/9/decide')
  expect(JSON.parse(String(post?.options?.body))).toEqual({ approved: true, paths: ['a.txt'] })
})
