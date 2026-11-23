// @vitest-environment jsdom
// Global push-to-talk pill: floating mic, recording state, transcribe through
// the gateway, transcript to the clipboard.
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@/i18n'
import { apiFetch } from '@/lib/api'
import { toast } from '@/lib/toast'
import { copyText } from '@/lib/clipboard'
import { GlobalDictation } from './global-dictation'

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/clipboard', () => ({ copyText: vi.fn() }))

class FakeRecorder {
  static instances: FakeRecorder[] = []
  state: 'inactive' | 'recording' = 'inactive'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null
  static isTypeSupported = () => true
  constructor() { FakeRecorder.instances.push(this) }
  start() { this.state = 'recording' }
  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob(['audio'], { type: 'audio/webm' }) })
    this.onstop?.()
  }
}

let root: Root
let container: HTMLDivElement
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }

beforeAll(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
beforeEach(() => {
  FakeRecorder.instances = []
  vi.mocked(apiFetch).mockImplementation(async (path: string) => {
    if (path === '/api/media') {
      return { models: [{ id: 1, platform: 'groq', modelId: 'whisper-large-v3-turbo', displayName: 'Whisper', modality: 'transcription', enabled: 1, keyCount: 1 }] }
    }
    return { apiKey: 'unified-test-key' }
  })
  vi.mocked(copyText).mockResolvedValue(true)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  act(() => root.render(
    <QueryClientProvider client={client}><I18nProvider initialLocale="en"><GlobalDictation /></I18nProvider></QueryClientProvider>,
  ))
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  delete (window as unknown as { __OMNIPIX_DICTATION__?: unknown }).__OMNIPIX_DICTATION__
})

it('renders the mic toggle with its shortcut hint', () => {
  const toggle = container.querySelector('[aria-label="Dictate (transcribe speech)"]') as HTMLButtonElement
  expect(toggle).toBeTruthy()
  expect(toggle.title).toContain('Ctrl+Shift+Space')
})

it('reports unsupported recording instead of crashing', async () => {
  vi.stubGlobal('MediaRecorder', undefined)
  Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true })
  await flush()
  const toggle = container.querySelector('[aria-label="Dictate (transcribe speech)"]') as HTMLButtonElement
  await act(async () => { toggle.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  expect(vi.mocked(toast.error)).toHaveBeenCalledWith(expect.stringContaining('MediaRecorder is not supported'))
})

it('records, transcribes through the gateway, and copies the text', async () => {
  vi.stubGlobal('MediaRecorder', FakeRecorder as unknown as typeof MediaRecorder)
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }) },
    configurable: true,
  })
  const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ text: 'hello world' }), { status: 200 }))
  vi.stubGlobal('fetch', fetchSpy)

  await flush()
  const toggle = container.querySelector('[aria-label="Dictate (transcribe speech)"]') as HTMLButtonElement
  await act(async () => { toggle.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  expect(FakeRecorder.instances).toHaveLength(1)
  expect(container.textContent).toContain('0:00')

  const stop = container.querySelector('[aria-label="Stop and transcribe"]') as HTMLButtonElement
  await act(async () => { stop.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()

  expect(fetchSpy).toHaveBeenCalledWith(
    expect.stringContaining('/v1/audio/transcriptions'),
    expect.objectContaining({ method: 'POST' }),
  )
  const body = (fetchSpy.mock.calls[0] as unknown as [string, { body: FormData }])[1].body
  expect(body.get('model')).toBe('auto')
  expect(vi.mocked(copyText)).toHaveBeenCalledWith('hello world')
  expect(vi.mocked(toast.success)).toHaveBeenCalledWith('Transcript copied — paste anywhere')
})

it('answers the desktop hotkey event instead of the browser chord', async () => {
  let toggleCb: (() => void) | null = null
  ;(window as unknown as { __OMNIPIX_DICTATION__?: unknown }).__OMNIPIX_DICTATION__ = {
    hotkey: async () => 'CommandOrControl+Shift+Space',
    onToggle: (cb: () => void) => { toggleCb = cb; return () => { toggleCb = null } },
  }
  // The bridge must exist before mount: the effect subscribes once.
  act(() => root.unmount())
  container.remove()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  act(() => root.render(
    <QueryClientProvider client={client}><I18nProvider initialLocale="en"><GlobalDictation /></I18nProvider></QueryClientProvider>,
  ))
  vi.stubGlobal('MediaRecorder', FakeRecorder as unknown as typeof MediaRecorder)
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }) },
    configurable: true,
  })
  await flush()
  expect(toggleCb).toBeTruthy()
  await act(async () => { toggleCb!() })
  await flush()
  expect(FakeRecorder.instances).toHaveLength(1)
})

it('refuses to record when no transcription model is usable', async () => {
  vi.mocked(apiFetch).mockImplementation(async (path: string) => {
    if (path === '/api/media') return { models: [] }
    return { apiKey: 'unified-test-key' }
  })
  // Remount so the media query runs against the emptied registry.
  act(() => root.unmount())
  container.remove()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  act(() => root.render(
    <QueryClientProvider client={client}><I18nProvider initialLocale="en"><GlobalDictation /></I18nProvider></QueryClientProvider>,
  ))
  vi.stubGlobal('MediaRecorder', FakeRecorder as unknown as typeof MediaRecorder)
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn() },
    configurable: true,
  })
  await flush()
  const toggle = container.querySelector('[aria-label="Dictate (transcribe speech)"]') as HTMLButtonElement
  await act(async () => { toggle.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  expect(FakeRecorder.instances).toHaveLength(0)
  expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled()
  expect(vi.mocked(toast.error)).toHaveBeenCalledWith(expect.stringContaining('Keys page'))
})
