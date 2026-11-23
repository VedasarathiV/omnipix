// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n'
import { apiFetch } from '@/lib/api'

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }))

const mocked = vi.mocked(apiFetch)
let root: Root
let container: HTMLElement

async function mount(tab: string) {
  const { Panel } = await import('./panel')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => {
    root.render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <I18nProvider initialLocale="en">
            <Panel tab={tab as never} onTabChange={() => {}} onClose={() => {}} />
          </I18nProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    )
  })
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

beforeEach(() => { vi.resetAllMocks() })
afterEach(() => { act(() => root.unmount()); container.remove() })

describe('panel terminal tab', () => {
  it('runs a command and shows output', async () => {
    mocked.mockImplementation(async (path: string) => {
      if (path === '/api/terminal/cwd') return { cwd: '/tmp' } as never
      return { stdout: 'term-ok\n', stderr: '', exitCode: 0 } as never
    })
    await mount('terminal')
    expect(container.textContent).toContain('/tmp')
    const input = container.querySelector('input[placeholder="Run a command…"]') as HTMLInputElement
    await act(async () => {
      input.focus()
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'echo term-ok')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    expect(container.textContent).toContain('term-ok')
    expect(mocked).toHaveBeenCalledWith('/api/terminal/exec', expect.objectContaining({ method: 'POST' }))
  })

  it('runs inside the open folder when one is open', async () => {
    localStorage.setItem('omnipix.openFolder', JSON.stringify({ root: '/proj', tree: 'proj/', files: 1, truncated: false }))
    try {
      mocked.mockImplementation(async (path: string) => {
        if (path === '/api/terminal/cwd') return { cwd: '/tmp' } as never
        return { stdout: '', stderr: '', exitCode: 0 } as never
      })
      await mount('terminal')
      expect(container.textContent).toContain('/proj')
      const input = container.querySelector('input[placeholder="Run a command…"]') as HTMLInputElement
      await act(async () => {
        input.focus()
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
        setter.call(input, 'pwd')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await act(async () => {
        container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      })
      for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) })
      const exec = mocked.mock.calls.find(([p]) => p === '/api/terminal/exec')
      expect(JSON.parse(String((exec?.[1] as RequestInit)?.body))).toEqual({ command: 'pwd', cwd: '/proj' })
    } finally {
      localStorage.removeItem('omnipix.openFolder')
    }
  })
})

describe('panel files tab', () => {
  it('browses a root and previews a file', async () => {
    mocked.mockImplementation(async (path: string) => {
      if (String(path).startsWith('/api/fs/list')) {
        return { root: '/proj', entries: [{ path: 'a.txt', kind: 'file' }], truncated: false } as never
      }
      return { content: 'hello file' } as never
    })
    await mount('files')
    const root = container.querySelector('input[placeholder*="Folder path"]') as HTMLInputElement
    await act(async () => {
      root.focus()
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(root, '/proj')
      root.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    expect(container.textContent).toContain('a.txt')
    await act(async () => {
      ;(Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'a.txt') as HTMLButtonElement).click()
    })
    for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    expect(container.textContent).toContain('hello file')
  })
})
