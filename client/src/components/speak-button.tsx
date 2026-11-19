import { Loader2, Volume2 } from 'lucide-react'
import { useI18n } from '@/i18n'
import { toast } from '@/lib/toast'
import { getSpeakState, speakText, stopSpeech, toSpokenText, useSpeakState, useVoiceSettings } from '@/lib/speech'

/**
 * Voice-out button: speaks text through the gateway TTS endpoint using the
 * voice settings (model + voice). One utterance app-wide — pressing another
 * speak button stops this one. Markdown is rewritten for the ear first.
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
  const state = useSpeakState()
  const { data: voice } = useVoiceSettings()

  async function speak() {
    if (getSpeakState() !== 'idle') {
      stopSpeech()
      return
    }
    if (!apiKey) {
      toast.error(t('speech.noKey'))
      return
    }
    if (!toSpokenText(text).trim()) return
    try {
      await speakText(text, { apiKey, model: voice?.ttsModel, voice: voice?.ttsVoice })
    } catch (err) {
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
