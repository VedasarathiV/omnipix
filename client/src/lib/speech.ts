// Shared speech helpers for the voice agent: markdown replies are written to
// be READ, so reading them aloud verbatim speaks gibberish ("backtick backtick
// backtick"). toSpokenText rewrites a reply for the ear, and the speech bus
// below plays one utterance app-wide so two speak buttons never overlap.

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './api'

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

export interface VoiceSettings {
  ttsModel: string
  ttsVoice: string
  sttModel: string
  autoSpeakChat: boolean
  autoSpeakRuns: boolean
}

export function useVoiceSettings() {
  return useQuery<VoiceSettings>({
    queryKey: ['settings', 'voice'],
    queryFn: () => apiFetch('/api/settings/voice'),
  })
}

export function useSaveVoiceSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<VoiceSettings>) =>
      apiFetch<VoiceSettings>('/api/settings/voice', { method: 'PUT', body: JSON.stringify(patch) }),
    onSuccess: data => queryClient.setQueryData(['settings', 'voice'], data),
  })
}

/** Live speech-bus state for buttons and indicators. */
export function useSpeakState(): SpeakState {
  const [s, setS] = useState<SpeakState>(() => getSpeakState())
  useEffect(() => onSpeakState(setS), [])
  return s
}

/** Rewrite markdown for speech: code becomes a summary, markup is dropped. */
export function toSpokenText(markdown: string, maxChars = 2000): string {
  let text = markdown
  // Fenced code blocks -> "code block, N lines".
  text = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang: string, code: string) => {
    const lines = code.split('\n').filter(l => l.trim()).length
    const what = lang ? `${lang} code block` : 'code block'
    return `\n${what}, ${lines} line${lines === 1 ? '' : 's'}.\n`
  })
  // Inline code -> the words, without backticks.
  text = text.replace(/`([^`]+)`/g, '$1')
  // Images -> alt text. Links -> link text.
  text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  // Headings, quotes, emphasis, rules, list markers.
  text = text.replace(/^#{1,6}\s+/gm, '')
  text = text.replace(/^>\s?/gm, '')
  text = text.replace(/(\*\*|__)(.*?)\1/g, '$2')
  text = text.replace(/(\*|_)(.*?)\1/g, '$2')
  text = text.replace(/^(\s*[-*+]|\s*\d+\.)\s+/gm, '')
  text = text.replace(/^[-*_]{3,}\s*$/gm, '')
  // Tables: drop the pipe chrome, keep the words.
  text = text.replace(/\|/g, ', ')
  // Collapse whitespace.
  text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  return text.slice(0, maxChars)
}

export interface SpeakOptions {
  apiKey: string
  model?: string
  voice?: string
}

type SpeakState = 'idle' | 'loading' | 'playing'

// One utterance app-wide: a new speak() stops whatever is playing, so the
// chat reply and the run announcer never talk over each other.
let current: HTMLAudioElement | null = null
let currentUrl: string | null = null
let state: SpeakState = 'idle'
const listeners = new Set<(s: SpeakState) => void>()

function setState(next: SpeakState) {
  state = next
  for (const fn of listeners) {
    try { fn(next) } catch { /* listener error must not break playback */ }
  }
}

export function getSpeakState(): SpeakState {
  return state
}

export function onSpeakState(fn: (s: SpeakState) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function stopSpeech() {
  current?.pause()
  current = null
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl)
    currentUrl = null
  }
  if (state !== 'idle') setState('idle')
}

/** Speak text through the gateway TTS endpoint. Resolves when it finishes. */
export async function speakText(text: string, opts: SpeakOptions): Promise<void> {
  stopSpeech()
  const input = toSpokenText(text).trim()
  if (!input) return
  setState('loading')
  try {
    const res = await fetch(`${BASE}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify({
        input,
        ...(opts.model && opts.model !== 'auto' ? { model: opts.model } : {}),
        ...(opts.voice ? { voice: opts.voice } : {}),
      }),
    })
    if (!res.ok) {
      const detail = await res.json().then(
        (data: unknown) => (data as { error?: { message?: string } })?.error?.message,
        () => undefined,
      ).catch(() => undefined)
      throw new Error(detail || 'speech synthesis failed')
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    currentUrl = url
    const audio = new Audio(url)
    current = audio
    setState('playing')
    await new Promise<void>((resolve, reject) => {
      audio.onended = () => resolve()
      audio.onerror = () => reject(new Error('speech playback failed'))
      void audio.play().catch(reject)
    })
  } finally {
    stopSpeech()
  }
}
