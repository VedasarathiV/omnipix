import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Play } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { useI18n } from '@/i18n'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { speakText, useSaveVoiceSettings, useVoiceSettings } from '@/lib/speech'
import type { TranscriptionModelRow } from '@/lib/transcription'

interface MediaData {
  models: TranscriptionModelRow[]
}

function usable(models: TranscriptionModelRow[], modality: TranscriptionModelRow['modality']) {
  const seen = new Set<string>()
  return models.filter(m => {
    if (m.modality !== modality || !m.enabled || m.keyCount <= 0 || seen.has(m.modelId)) return false
    seen.add(m.modelId)
    return true
  })
}

export function VoiceSection() {
  const { t } = useI18n()
  const { data: voice } = useVoiceSettings()
  const save = useSaveVoiceSettings()
  const { data: mediaData } = useQuery<MediaData>({
    queryKey: ['media'],
    queryFn: () => apiFetch('/api/media'),
  })
  const { data: keyData } = useQuery<{ apiKey: string }>({
    queryKey: ['unified-key'],
    queryFn: () => apiFetch('/api/settings/api-key'),
  })
  const [testing, setTesting] = useState(false)

  const models = mediaData?.models ?? []
  const ttsModels = usable(models, 'audio')
  const sttModels = usable(models, 'transcription')

  async function testVoice() {
    if (!keyData?.apiKey) {
      toast.error(t('speech.noKey'))
      return
    }
    setTesting(true)
    try {
      await speakText(t('settings.voiceSample'), {
        apiKey: keyData.apiKey,
        model: voice?.ttsModel,
        voice: voice?.ttsVoice,
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('speech.failed'))
    } finally {
      setTesting(false)
    }
  }

  return (
    <>
      <div className="mb-5 space-y-1.5">
        <h2 className="font-heading text-base leading-snug font-medium">{t('settings.sectionVoice')}</h2>
        <p className="text-xs leading-relaxed text-muted-foreground">{t('settings.voiceDescription')}</p>
      </div>

      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="voice-tts-model">{t('settings.ttsModel')}</Label>
          <select
            id="voice-tts-model"
            value={voice?.ttsModel ?? 'auto'}
            onChange={e => save.mutate({ ttsModel: e.target.value })}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-xs"
          >
            <option value="auto">{t('playground.autoModel')}</option>
            {ttsModels.map(m => (
              <option key={m.id} value={m.modelId}>{m.displayName}</option>
            ))}
          </select>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="voice-tts-voice">{t('settings.ttsVoice')}</Label>
          <div className="flex gap-2">
            <Input
              id="voice-tts-voice"
              value={voice?.ttsVoice ?? ''}
              onChange={e => save.mutate({ ttsVoice: e.target.value })}
              placeholder={t('settings.ttsVoicePlaceholder')}
              className="font-mono"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void testVoice()}
              disabled={testing}
              aria-label={t('settings.testVoice')}
            >
              {testing ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
              {t('settings.testVoice')}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">{t('settings.ttsVoiceHint')}</p>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="voice-stt-model">{t('settings.sttModel')}</Label>
          <select
            id="voice-stt-model"
            value={voice?.sttModel ?? 'auto'}
            onChange={e => save.mutate({ sttModel: e.target.value })}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-xs"
          >
            <option value="auto">{t('playground.autoModel')}</option>
            {sttModels.map(m => (
              <option key={m.id} value={m.modelId}>{m.displayName}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-border/60 pt-4">
          <span className="text-sm font-medium">{t('settings.autoSpeakChat')}</span>
          <Switch
            aria-label={t('settings.autoSpeakChat')}
            checked={voice?.autoSpeakChat ?? false}
            onCheckedChange={checked => save.mutate({ autoSpeakChat: checked })}
          />
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-border/60 pt-4">
          <span className="text-sm font-medium">{t('settings.autoSpeakRuns')}</span>
          <Switch
            aria-label={t('settings.autoSpeakRuns')}
            checked={voice?.autoSpeakRuns ?? false}
            onCheckedChange={checked => save.mutate({ autoSpeakRuns: checked })}
          />
        </div>
      </div>
    </>
  )
}
