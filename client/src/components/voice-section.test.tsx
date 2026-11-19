// @vitest-environment jsdom
// Voice section: renders model pickers from /api/media, saves prefs through
// the voice settings endpoint, and speaks a sample on Test.
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@/i18n'
import { apiFetch } from '@/lib/api'
import { VoiceSection } from './voice-section'

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn(), getToken: () => null }))

const mocked = vi.mocked(apiFetch)
let root: Root
let container: HTMLDivElement
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }

const MEDIA = {
  models: [
    { id: 1, platform: 'cartesia', modelId: 'sonic-3', displayName: 'Sonic 3', modality: 'audio', enabled: 1, keyCount: 1 },
    { id: 2, platform: 'groq', modelId: 'whisper-large-v3-turbo', displayName: 'Whisper', modality: 'transcription', enabled: 1, keyCount: 1 },
  ],
}
const VOICE = { ttsModel: 'auto', ttsVoice: '', sttModel: 'auto', autoSpeakChat: false, autoSpeakRuns: false }

function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  root.render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <VoiceSection />
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
    if (path === '/api/media') return MEDIA as never
    if (path === '/api/settings/voice') return VOICE as never
    if (path === '/api/settings/api-key') return { apiKey: 'u-key' } as never
    throw new Error(`unexpected ${path}`)
  })
})
afterEach(() => { act(() => root.unmount()); container.remove() })

it('lists speech and dictation models with Auto first', async () => {
  render()
  await flush()
  const tts = container.querySelector('#voice-tts-model') as HTMLSelectElement
  expect(tts.options[0].value).toBe('auto')
  expect(tts.textContent).toContain('Sonic 3')
  expect(tts.textContent).not.toContain('Whisper')
  const stt = container.querySelector('#voice-stt-model') as HTMLSelectElement
  expect(stt.options[0].value).toBe('auto')
  expect(stt.textContent).toContain('Whisper')
  expect(stt.textContent).not.toContain('Sonic 3')
})

it('saves toggles and voice id through the API', async () => {
  const calls: Array<{ path: string; options?: RequestInit }> = []
  mocked.mockImplementation(async (path: string, options?: RequestInit) => {
    calls.push({ path, options })
    if (path === '/api/media') return MEDIA as never
    if (path === '/api/settings/voice' && !options?.method) return VOICE as never
    if (path === '/api/settings/voice' && options?.method === 'PUT') return { ...VOICE, autoSpeakChat: true } as never
    if (path === '/api/settings/api-key') return { apiKey: 'u-key' } as never
    throw new Error(`unexpected ${path}`)
  })
  render()
  await flush()
  const toggle = container.querySelector('[aria-label="Read chat replies aloud"]') as HTMLButtonElement
  await act(async () => { toggle.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  const put = calls.find(c => c.options?.method === 'PUT')
  expect(put?.path).toBe('/api/settings/voice')
  expect(String(put?.options?.body)).toContain('"autoSpeakChat":true')
})
