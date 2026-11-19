import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Mic, Square } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { copyText } from '@/lib/clipboard'
import { toast } from '@/lib/toast'
import { useI18n } from '@/i18n'
import { startDictationRecording, type DictationRecorder } from '@/lib/dictation-recorder'
import { hasTranscription, type TranscriptionModelRow } from '@/lib/transcription'

type Phase = 'idle' | 'recording' | 'transcribing'

interface DictationBridge {
  hotkey: () => Promise<string | null>
  onToggle: (cb: () => void) => () => void
}

function desktopBridge(): DictationBridge | null {
  const w = window as unknown as { __OMNIPIX_DICTATION__?: DictationBridge }
  return w.__OMNIPIX_DICTATION__ ?? null
}

function formatHotkey(accelerator: string): string {
  return /mac/i.test(navigator.platform)
    ? accelerator
      .replaceAll('CommandOrControl', '⌘')
      .replaceAll('Shift', '⇧')
      .replaceAll('Alt', '⌥')
      .replaceAll('+', '')
    : accelerator.replaceAll('CommandOrControl', 'Ctrl')
}

// System-wide push-to-talk, WhisperFlow-lite: a floating mic pill, toggled by
// the desktop global hotkey (or Ctrl/Cmd+Shift+Space in the browser). Stop
// transcribes through the gateway's own /v1/audio/transcriptions route — any
// provider, same failover as API clients — and copies the text so it can be
// pasted anywhere. (True type-into-app needs OS key synthesis; clipboard is
// the honest v1.)

export function GlobalDictation() {
  const { t } = useI18n()
  const [phase, setPhase] = useState<Phase>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [hotkey, setHotkey] = useState<string | null>(null)
  const recorderRef = useRef<DictationRecorder | null>(null)
  const phaseRef = useRef<Phase>('idle')
  useEffect(() => { phaseRef.current = phase }, [phase])

  const { data: keyData } = useQuery<{ apiKey: string }>({
    queryKey: ['unified-key'],
    queryFn: () => apiFetch('/api/settings/api-key'),
  })
  const apiKey = keyData?.apiKey
  const { data: mediaData } = useQuery<{ models: TranscriptionModelRow[] }>({
    queryKey: ['media'],
    queryFn: () => apiFetch('/api/media'),
  })

  const stopAndTranscribe = useCallback(async () => {
    const recorder = recorderRef.current
    recorderRef.current = null
    if (!recorder) {
      setPhase('idle')
      return
    }
    setPhase('transcribing')
    try {
      const { blob, filename } = await recorder.stop()
      const form = new FormData()
      form.append('file', blob, filename)
      form.append('model', 'auto')
      const headers: Record<string, string> = {}
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
      const base = import.meta.env.BASE_URL.replace(/\/$/, '')
      const res = await fetch(`${base}/v1/audio/transcriptions`, { method: 'POST', headers, body: form })
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: { message?: string } } | null
        throw new Error(body?.error?.message || `HTTP ${res.status}`)
      }
      const data = await res.json() as { text?: string }
      const text = data.text ?? ''
      if (text && await copyText(text)) {
        toast.success(t('dictation.copied'))
      } else if (text) {
        toast.error(t('playground.dictationFailed', { reason: 'clipboard unavailable' }))
      }
    } catch (err: unknown) {
      toast.error(t('playground.dictationFailed', { reason: err instanceof Error ? err.message : String(err) }))
    } finally {
      setPhase('idle')
      setElapsed(0)
    }
  }, [apiKey, t])

  const startRecording = useCallback(async () => {
    // Never record into a dead end: with no usable transcription model the
    // take could only fail at upload, so say what's missing up front.
    if (!hasTranscription(mediaData?.models ?? [])) {
      toast.error(t('dictation.noModels'))
      return
    }
    try {
      recorderRef.current = await startDictationRecording()
      setElapsed(0)
      setPhase('recording')
    } catch (err: unknown) {
      recorderRef.current = null
      toast.error(t('playground.dictationFailed', { reason: err instanceof Error ? err.message : String(err) }))
    }
  }, [mediaData, t])

  const toggleRef = useRef(() => {})
  useEffect(() => {
    toggleRef.current = () => {
      if (phaseRef.current === 'idle') void startRecording()
      else if (phaseRef.current === 'recording') void stopAndTranscribe()
      // Transcribing: still working the last take, ignore the toggle.
    }
  }, [startRecording, stopAndTranscribe])

  // Desktop global hotkey, or the same chord locally in the browser (never
  // both — in Electron the main-process hotkey already fires this path).
  useEffect(() => {
    const bridge = desktopBridge()
    if (bridge) {
      bridge.hotkey().then(setHotkey).catch(() => setHotkey(null))
      return bridge.onToggle(() => toggleRef.current())
    }
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.code !== 'Space') return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      e.preventDefault()
      toggleRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (phase !== 'recording') return
    const timer = setInterval(() => setElapsed(s => s + 1), 1000)
    return () => clearInterval(timer)
  }, [phase])

  const hint = hotkey ? formatHotkey(hotkey) : 'Ctrl+Shift+Space'
  return (
    <div className="fixed bottom-4 left-4 z-50" role="status" aria-live="polite">
      {phase === 'idle' ? (
        <button
          type="button"
          onClick={() => toggleRef.current()}
          aria-label={t('dictation.toggle')}
          title={`${t('dictation.toggle')} (${hint})`}
          className="flex size-11 items-center justify-center rounded-full border bg-card shadow-lg transition-colors hover:bg-muted"
        >
          <Mic className="size-5 text-muted-foreground" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => toggleRef.current()}
          aria-label={t('dictation.stop')}
          className="flex items-center gap-2 rounded-full border bg-card py-2 pl-3 pr-4 shadow-lg"
        >
          {phase === 'recording' ? (
            <>
              <span className="size-2.5 animate-pulse rounded-full bg-destructive" aria-hidden="true" />
              <span className="font-mono text-xs tabular-nums">
                {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
              </span>
              <Square className="size-3.5 text-muted-foreground" />
            </>
          ) : (
            <>
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{t('dictation.transcribing')}</span>
            </>
          )}
        </button>
      )}
    </div>
  )
}
