// @vitest-environment jsdom
// Local speech-engine shortcut on the custom provider form: one-click
// whisper.cpp-style defaults plus a connection test that saves nothing.
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@/i18n'
import { apiFetch } from '@/lib/api'
import { CustomProviderSection } from './custom-provider-section'

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (v: string) => void; children: ReactNode }) => (
    <select data-testid="custom-type" value={value} onChange={e => onValueChange(e.target.value)}>{children}</select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => <option value={value}>{children}</option>,
}))

let root: Root
let container: HTMLDivElement

beforeAll(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
beforeEach(() => {
  vi.mocked(apiFetch).mockReset().mockResolvedValue({ reachable: true, status: 200, endpoint: '/models' })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  act(() => root.render(<QueryClientProvider client={client}><I18nProvider initialLocale="en"><CustomProviderSection /></I18nProvider></QueryClientProvider>))
})
afterEach(() => { act(() => root.unmount()); container.remove() })

function setType(value: string) {
  const select = container.querySelector<HTMLSelectElement>('[data-testid="custom-type"]')!
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

it('offers local-engine defaults only for transcription', () => {
  expect(container.textContent).not.toContain('Use local engine defaults')
  setType('transcription')
  expect(container.textContent).toContain('Use local engine defaults')
  expect(container.textContent).toContain('whisper.cpp')
})

it('preset fills whisper.cpp-style defaults without saving', () => {
  setType('transcription')
  vi.mocked(apiFetch).mockClear()
  const preset = [...container.querySelectorAll('button')].find(b => b.textContent === 'Use local engine defaults')!
  act(() => { preset.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  const baseUrl = container.querySelector('input[placeholder="http://127.0.0.1:11434/v1"]') as HTMLInputElement
  expect(baseUrl.value).toBe('http://127.0.0.1:8080/v1')
  expect(container.querySelector('textarea')!.value).toBe('local-stt')
  expect(vi.mocked(apiFetch)).not.toHaveBeenCalled()
})

it('test reports reachability inline', async () => {
  setType('transcription')
  const preset = [...container.querySelectorAll('button')].find(b => b.textContent === 'Use local engine defaults')!
  act(() => { preset.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  vi.mocked(apiFetch).mockClear()
  const test = [...container.querySelectorAll('button')].find(b => b.textContent === 'Test connection')!
  await act(async () => { test.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  expect(vi.mocked(apiFetch)).toHaveBeenCalledWith('/api/media/probe', expect.objectContaining({ method: 'POST' }))
  expect(container.textContent).toContain('Answered via /models')
})

it('test reports unreachable engines without saving', async () => {
  vi.mocked(apiFetch).mockResolvedValue({ reachable: false, error: 'connection refused' })
  setType('transcription')
  const preset = [...container.querySelectorAll('button')].find(b => b.textContent === 'Use local engine defaults')!
  act(() => { preset.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  const test = [...container.querySelectorAll('button')].find(b => b.textContent === 'Test connection')!
  await act(async () => { test.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  expect(container.textContent).toContain('Unreachable: connection refused')
})
