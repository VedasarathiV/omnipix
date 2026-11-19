import { useEffect, useRef, useState } from 'react'
import { Loader2, Volume2 } from 'lucide-react'
import { useI18n } from '@/i18n'
import { toast } from '@/lib/toast'

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
const MAX_CHARS = 2000;

/**
 * Voice-out button: sends text to the gateway's OpenAI-compatible TTS
 * endpoint and plays the returned audio. One utterance at a time per
 * button; object URLs and playback release on unmount or replay.
 */
export function SpeakButton({
  text,
  apiKey,
  className = '',
}: {
  text: string;
  apiKey?: string;
  className?: string;
}) {
  const { t } = useI18n()
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const urlRef = useRef<string | null>(null)

  function release() {
    audioRef.current?.pause()
    audioRef.current = null
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }
  }

  useEffect(() => release, [])

  async function speak() {
    if (state !== 'idle') {
      release()
      setState('idle')
      return
    }
    if (!apiKey) {
      toast.error(t('speech.noKey'))
      return
    }
    const input = text.trim().slice(0, MAX_CHARS)
    if (!input) return
    setState('loading')
    try {
      const res = await fetch(`${BASE}/v1/audio/speech`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ input }),
      })
      if (!res.ok) {
        // Surface the gateway's reason (e.g. no speech-capable key) instead
        // of a dead-end toast — it names the fix.
        const detail = await res.json().then(
          (data: unknown) => (data as { error?: { message?: string } })?.error?.message,
          () => undefined,
        ).catch(() => undefined)
        throw new Error(detail || t('speech.failed'))
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      urlRef.current = url
      const audio = new Audio(url)
      audioRef.current = audio
      audio.onended = () => {
        release()
        setState('idle')
      }
      audio.onerror = () => {
        release()
        setState('idle')
        toast.error(t('speech.failed'))
      }
      setState('playing')
      await audio.play()
    } catch (err) {
      release()
      setState('idle')
      toast.error(err instanceof Error ? err.message : t('speech.failed'))
    }
  }

  return (
    <button
      type="button"
      onClick={() => void speak()}
      disabled={state === 'loading'}
      aria-label={t('speech.speak')}
      title={t('speech.speak')}
      className={`inline-flex items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50 ${className}`}
    >
      {state === 'loading'
        ? <Loader2 className="size-3.5 animate-spin" />
        : <Volume2 className={state === 'playing' ? 'size-3.5 text-primary' : 'size-3.5'} />}
    </button>
  )
}
