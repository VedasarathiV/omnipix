// @vitest-environment jsdom
// Speak button: posts text to the TTS endpoint and plays the audio; a second
// click stops playback. Audio and fetch are stubbed.
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { I18nProvider } from '@/i18n'
import { SpeakButton } from './speak-button'

let root: Root
let container: HTMLDivElement
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }

const realFetch = globalThis.fetch
let posted: { url: string; body: string } | null = null

class FakeAudio {
  static instances: FakeAudio[] = []
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  paused = false
  src: string
  constructor(src: string) { this.src = src; FakeAudio.instances.push(this) }
  async play() { /* stays "playing" until stopped */ }
  pause() { this.paused = true }
}

beforeAll(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('Audio', FakeAudio as unknown as typeof Audio)
  vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:fake', revokeObjectURL: () => {} })
})

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  FakeAudio.instances = []
  posted = null
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    posted = { url: String(url), body: String(init?.body) }
    return new Response(new Blob(['audio-bytes']), { status: 200 })
  }) as unknown as typeof fetch
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  globalThis.fetch = realFetch
})

function render() {
  root.render(
    <I18nProvider>
      <SpeakButton text="Hello there" apiKey="u-key" />
    </I18nProvider>,
  )
}

it('posts text to TTS and plays the result, toggling on second click', async () => {
  render()
  await flush()
  const button = container.querySelector('button[aria-label="Read aloud"]') as HTMLButtonElement
  await act(async () => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  expect(posted?.url).toContain('/v1/audio/speech')
  expect(JSON.parse(posted?.body ?? '{}')).toMatchObject({ input: 'Hello there' })
  expect(FakeAudio.instances).toHaveLength(1)
  await act(async () => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  expect(FakeAudio.instances[0].paused).toBe(true)
  expect(FakeAudio.instances).toHaveLength(1)
})
