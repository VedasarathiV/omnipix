import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Mic, Play } from 'lucide-react';
import { useStudio } from '../state/store';
import { apiFetch } from '../lib/api';
import { speakText } from '../lib/voice';
import { useMedia, useUnifiedKey, useVoiceSettings } from '../lib/queries';

export function VoicePage() {
  const { pushToast } = useStudio();
  const queryClient = useQueryClient();
  const { data: voice } = useVoiceSettings();
  const { data: media } = useMedia();
  const { data: keyData } = useUnifiedKey();

  async function playSample() {
    if (!keyData?.apiKey) {
      pushToast('error', 'Add a provider key first.');
      return;
    }
    try {
      await speakText('Hello from OmniPix Studio.', keyData.apiKey, voice?.ttsModel, voice?.ttsVoice || undefined);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Sample failed');
    }
  }
  const [listening, setListening] = useState(false);
  const models = media?.models ?? [];
  const stt = models.filter(m => m.modality === 'transcription' && m.enabled);
  const tts = models.filter(m => m.modality === 'audio' && m.enabled);

  async function save(patch: Record<string, unknown>) {
    try {
      await apiFetch('/api/settings/voice', { method: 'PUT', body: JSON.stringify(patch) });
      void queryClient.invalidateQueries({ queryKey: ['voice-settings'] });
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Save failed');
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-5 py-4">
      <h1 className="mb-4 text-lg font-semibold">Voice</h1>
      <div className="rounded-xl border border-line bg-base-1 p-5 text-center">
        <button
          type="button"
          aria-label={listening ? 'Stop dictation' : 'Start dictation'}
          onClick={() => {
            setListening(l => !l);
            if (!listening) pushToast('info', 'Listening… (browser mic transcribes on release)');
          }}
          className={`mx-auto flex size-16 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            listening ? 'animate-pulse bg-bad text-base-0' : 'bg-accent text-base-0 hover:opacity-90'
          }`}
        >
          <Mic className="size-6" strokeWidth={1.5} />
        </button>
        <p className="mt-3 text-sm font-medium">{listening ? 'Listening…' : 'Tap to dictate'}</p>
        <p className="mt-1 font-mono text-[11px] text-ink-dim">{voice?.sttModel ?? 'auto'} · dictation model</p>
      </div>
      <div className="mt-3 divide-y divide-line rounded-xl border border-line bg-base-1 px-4">
        <div className="flex items-center justify-between gap-3 py-3">
          <div>
            <p className="text-[13px] font-medium">Dictation model</p>
            <p className="text-xs text-ink-dim">Speech-to-text for the mic</p>
          </div>
          <select
            value={voice?.sttModel ?? 'auto'}
            onChange={e => void save({ sttModel: e.target.value })}
            aria-label="Dictation model"
            className="rounded-lg border border-line bg-base-1 px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="auto">Auto</option>
            {stt.map(m => <option key={m.id} value={m.modelId}>{m.displayName}</option>)}
          </select>
        </div>
        <div className="flex items-center justify-between gap-3 py-3">
          <div>
            <p className="text-[13px] font-medium">Speech model</p>
            <p className="text-xs text-ink-dim">Text-to-speech voice for read-aloud</p>
          </div>
          <select
            value={voice?.ttsModel ?? 'auto'}
            onChange={e => void save({ ttsModel: e.target.value })}
            aria-label="Speech model"
            className="rounded-lg border border-line bg-base-1 px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="auto">Auto</option>
            {tts.map(m => <option key={m.id} value={m.modelId}>{m.displayName}</option>)}
          </select>
        </div>
        <div className="flex items-center justify-between gap-3 py-3">
          <div>
            <p className="text-[13px] font-medium">Read chats aloud</p>
            <p className="text-xs text-ink-dim">Speak new assistant messages</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={!!voice?.autoSpeakChat}
            aria-label="Read chats aloud"
            onClick={() => void save({ autoSpeakChat: !voice?.autoSpeakChat })}
            className={`relative h-5 w-9 shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent ${voice?.autoSpeakChat ? 'bg-accent' : 'bg-base-2'}`}
          >
            <span className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${voice?.autoSpeakChat ? 'left-[18px]' : 'left-0.5'}`} />
          </button>
        </div>
        <div className="flex items-center justify-between gap-3 py-3">
          <div>
            <p className="text-[13px] font-medium">Sample</p>
            <p className="text-xs text-ink-dim">Hear the current voice</p>
          </div>
          <button
            type="button"
            onClick={() => void playSample()}
            className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Play className="size-3.5" strokeWidth={1.5} /> Play
          </button>
        </div>
      </div>
    </div>
  );
}
