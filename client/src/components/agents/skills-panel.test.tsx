// @vitest-environment jsdom
// Skills panel: lists skills with built-in/custom badges, creates a new skill
// through the dialog, and toggles enablement.
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@/i18n'
import { apiFetch } from '@/lib/api'
import { SkillsPanel } from './skills-panel'

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn(), getToken: () => null }))

const mocked = vi.mocked(apiFetch)
let root: Root
let container: HTMLDivElement
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }

const SKILLS = [
  { name: 'planner', description: 'Plan first', instructions: 'Make a plan.', enabled: 1, builtin: 1 },
  { name: 'mine', description: 'Custom', instructions: 'Do custom.', enabled: 0, builtin: 0 },
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
        <SkillsPanel />
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
    if (path === '/api/skills') return { skills: SKILLS } as never
    if (path === '/api/agents/proposals') return { proposals: [] } as never
    throw new Error(`unexpected ${path}`)
  })
})
afterEach(() => { act(() => root.unmount()); container.remove() })

it('lists skills with built-in and custom badges', async () => {
  render()
  await flush()
  expect(container.textContent).toContain('planner')
  expect(container.textContent).toContain('Built-in')
  expect(container.textContent).toContain('mine')
  expect(container.textContent).toContain('Custom')
})

it('creates a skill through the dialog', async () => {
  const calls: Array<{ path: string; options?: RequestInit }> = []
  mocked.mockImplementation(async (path: string, options?: RequestInit) => {
    calls.push({ path, options })
    if (path === '/api/skills' && !options?.method) return { skills: SKILLS } as never
    if (path === '/api/agents/proposals' && !options?.method) return { proposals: [] } as never
    if (path === '/api/skills' && options?.method === 'POST') {
      return { skill: { name: 'newbie', enabled: 1, builtin: 0 } } as never
    }
    throw new Error(`unexpected ${path}`)
  })
  render()
  await flush()
  const open = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('New skill')) as HTMLButtonElement
  await act(async () => { open.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  await act(async () => {
    // The dialog renders in a portal on document.body, outside the container.
    setInput(document.querySelector('#skill-name') as HTMLInputElement, 'newbie')
    setInput(document.querySelector('#skill-desc') as HTMLInputElement, 'A new skill')
    setInput(document.querySelector('#skill-instructions') as HTMLTextAreaElement, 'Do the thing.')
  })
  await flush()
  const create = Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Create') as HTMLButtonElement
  expect(create.disabled).toBe(false)
  await act(async () => { create.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  const post = calls.find(c => c.options?.method === 'POST')
  expect(post?.path).toBe('/api/skills')
  expect(String(post?.options?.body)).toContain('newbie')
})

it('toggles a skill off', async () => {
  const calls: Array<{ path: string; options?: RequestInit }> = []
  mocked.mockImplementation(async (path: string, options?: RequestInit) => {
    calls.push({ path, options })
    if (path === '/api/skills' && !options?.method) return { skills: SKILLS } as never
    if (path === '/api/agents/proposals' && !options?.method) return { proposals: [] } as never
    return { skill: SKILLS[0] } as never
  })
  render()
  await flush()
  const toggle = container.querySelector('[role="switch"][aria-label="Disable"]') as HTMLButtonElement
  expect(toggle).toBeTruthy()
  await act(async () => { toggle.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  const patch = calls.find(c => c.options?.method === 'PATCH')
  expect(patch?.path).toBe('/api/skills/planner')
  expect(String(patch?.options?.body)).toContain('"enabled":false')
})

it('exports a skill to a downloaded file', async () => {
  mocked.mockImplementation(async (path: string) => {
    if (path === '/api/skills') return { skills: SKILLS } as never
    if (path === '/api/agents/proposals') return { proposals: [] } as never
    if (path === '/api/skills/planner/export') {
      return { name: 'planner', content: '---\nname: planner\n---\nPlan.' } as never
    }
    throw new Error(`unexpected ${path}`)
  })
  const created: Blob[] = []
  const realCreate = URL.createObjectURL
  const realRevoke = URL.revokeObjectURL
  URL.createObjectURL = ((blob: Blob) => { created.push(blob); return 'blob:fake' }) as typeof URL.createObjectURL
  URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL
  try {
    render()
    await flush()
    const exportBtn = container.querySelector('button[aria-label="Export planner"]') as HTMLButtonElement
    expect(exportBtn).toBeTruthy()
    await act(async () => { exportBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await flush()
    expect(created).toHaveLength(1)
    expect(created[0].type).toBe('text/markdown')
    expect(created[0].size).toBeGreaterThan(0)
  } finally {
    URL.createObjectURL = realCreate
    URL.revokeObjectURL = realRevoke
  }
})

it('imports a skill from pasted content', async () => {
  const calls: Array<{ path: string; options?: RequestInit }> = []
  mocked.mockImplementation(async (path: string, options?: RequestInit) => {
    calls.push({ path, options })
    if (path === '/api/skills' && !options?.method) return { skills: SKILLS } as never
    if (path === '/api/agents/proposals' && !options?.method) return { proposals: [] } as never
    if (path === '/api/skills/import' && options?.method === 'POST') return { skill: { name: 'newbie' } } as never
    throw new Error(`unexpected ${path}`)
  })
  render()
  await flush()
  const open = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Import')) as HTMLButtonElement
  await act(async () => { open.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  await act(async () => {
    setInput(document.querySelector('#skill-import') as HTMLTextAreaElement, '---\nname: newbie\n---\nDo it.')
  })
  await flush()
  const importBtns = Array.from(document.querySelectorAll('button')).filter(b => b.textContent?.trim() === 'Import')
  const importBtn = importBtns[importBtns.length - 1] as HTMLButtonElement
  expect(importBtn.disabled).toBe(false)
  await act(async () => { importBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  const post = calls.find(c => c.path === '/api/skills/import')
  expect(String(post?.options?.body)).toContain('name: newbie')
})

it('installs a skill straight from a URL', async () => {
  const calls: Array<{ path: string; options?: RequestInit }> = []
  mocked.mockImplementation(async (path: string, options?: RequestInit) => {
    calls.push({ path, options })
    if (path === '/api/skills' && !options?.method) return { skills: SKILLS } as never
    if (path === '/api/agents/proposals' && !options?.method) return { proposals: [] } as never
    if (path === '/api/skills/import-url' && options?.method === 'POST') return { skill: { name: 'remote' } } as never
    throw new Error(`unexpected ${path}`)
  })
  render()
  await flush()
  const open = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Import')) as HTMLButtonElement
  await act(async () => { open.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  await act(async () => {
    setInput(document.querySelector('#skill-import-url') as HTMLInputElement, '  https://example.com/SKILL.md  ')
  })
  await flush()
  const install = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Install') as HTMLButtonElement
  expect(install.disabled).toBe(false)
  await act(async () => { install.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  const post = calls.find(c => c.path === '/api/skills/import-url')
  expect(String(post?.options?.body)).toBe(JSON.stringify({ url: 'https://example.com/SKILL.md' }))
})

it('reviews learning proposals', async () => {
  const calls: Array<{ path: string; options?: RequestInit }> = []
  mocked.mockImplementation(async (path: string, options?: RequestInit) => {
    calls.push({ path, options })
    if (path === '/api/skills' && !options?.method) return { skills: SKILLS } as never
    if (path === '/api/agents/proposals' && !options?.method) {
      return {
        proposals: [
          { id: 7, kind: 'skill', title: 'explorer', body_json: JSON.stringify({ name: 'explorer', description: 'Explore first.', instructions: 'Look.' }), source_run_id: 3, status: 'pending' },
          { id: 8, kind: 'memory', title: 'lesson-x', body_json: JSON.stringify({ key: 'lesson-x', value: 'Do not do that thing.', scope: 'user' }), source_run_id: 4, status: 'pending' },
        ],
      } as never
    }
    if (path === '/api/agents/proposals/7/accept' && options?.method === 'POST') return { proposal: { id: 7, status: 'accepted' } } as never
    if (path === '/api/agents/proposals/8/discard' && options?.method === 'POST') return { proposal: { id: 8, status: 'discarded' } } as never
    throw new Error(`unexpected ${path}`)
  })
  render()
  await flush()
  expect(container.textContent).toContain('explorer')
  expect(container.textContent).toContain('Explore first.')
  expect(container.textContent).toContain('[user] lesson-x: Do not do that thing.')
  const accept = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Accept') as HTMLButtonElement
  await act(async () => { accept.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  const discards = Array.from(container.querySelectorAll('button')).filter(b => b.textContent === 'Discard') as HTMLButtonElement[]
  await act(async () => { discards[1].dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  expect(calls.some(c => c.path === '/api/agents/proposals/7/accept')).toBe(true)
  expect(calls.some(c => c.path === '/api/agents/proposals/8/discard')).toBe(true)
})

it('shows bundle members and sends the bundle on create', async () => {
  const calls: Array<{ path: string; options?: RequestInit }> = []
  mocked.mockImplementation(async (path: string, options?: RequestInit) => {
    calls.push({ path, options })
    if (path === '/api/skills' && !options?.method) {
      return { skills: [...SKILLS, { name: 'pack', description: 'A bundle', instructions: 'Load both.', enabled: 1, builtin: 0, bundle: ['planner', 'mine'] }] } as never
    }
    if (path === '/api/agents/proposals' && !options?.method) return { proposals: [] } as never
    if (path === '/api/skills' && options?.method === 'POST') {
      return { skill: { name: 'pack2', enabled: 1, builtin: 0 } } as never
    }
    throw new Error(`unexpected ${path}`)
  })
  render()
  await flush()
  expect(container.textContent).toContain('Bundle: planner, mine')
  const open = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('New skill')) as HTMLButtonElement
  await act(async () => { open.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  await act(async () => {
    setInput(document.querySelector('#skill-name') as HTMLInputElement, 'pack2')
    setInput(document.querySelector('#skill-desc') as HTMLInputElement, 'Another bundle')
    setInput(document.querySelector('#skill-instructions') as HTMLTextAreaElement, 'Load all.')
    setInput(document.querySelector('#skill-bundle') as HTMLInputElement, 'planner, mine')
  })
  await flush()
  const create = Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Create') as HTMLButtonElement
  await act(async () => { create.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  const post = calls.find(c => c.options?.method === 'POST')
  expect(String(post?.options?.body)).toContain('"bundle":["planner","mine"]')
})
