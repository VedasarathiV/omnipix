import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Mic, Play } from 'lucide-react';
import { useStudio } from '../state/store';
import { apiFetch } from '../lib/api';
import { speakText, startDictationRecording, stopSpeech, transcribeAudio, type DictationRecorder } from '../lib/voice';
import { useKeys, useMedia, useUnifiedKey, useVoiceSettings } from '../lib/queries';

export function VoicePage() {
  const { pushToast, setRail } = useStudio();
  const queryClient = useQueryClient();
  const { data: voice } = useVoiceSettings();
  const { data: media } = useMedia();
  const { data: keyData } = useUnifiedKey();
  const { data: keys = [] } = useKeys();
  const configuredKeys = keys.filter(k => k.enabled).length;

  async function playSample() {
    if (!keyData?.apiKey) {
      pushToast('error', 'Add a provider key first.');
      return;
    }
    setPlaying(true);
    try {
      await speakText('Hello from OmniPix Studio.', keyData.apiKey, voice?.ttsModel, voice?.ttsVoice || undefined);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Sample failed');
    } finally {
      setPlaying(false);
    }
  }

  async function registerCustom() {
    if (!custom.baseUrl.trim() || !custom.model.trim()) {
      pushToast('error', 'Base URL and model are required');
      return;
    }
    try {
      await apiFetch('/api/media/custom', {
        method: 'POST',
        body: JSON.stringify({
          baseUrl: custom.baseUrl.trim(),
          model: custom.model.trim(),
          modality: custom.modality,
          ...(custom.apiKey.trim() ? { apiKey: custom.apiKey.trim() } : {}),
          ...(custom.label.trim() ? { label: custom.label.trim() } : {}),
        }),
      });
      pushToast('ok', 'Local speech server registered');
      setCustom({ baseUrl: '', model: '', modality: 'transcription', apiKey: '', label: '' });
      void queryClient.invalidateQueries({ queryKey: ['media'] });
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Registration failed');
    }
  }
  const [recorder, setRecorder] = useState<DictationRecorder | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [playing, setPlaying] = useState(false);
  const [custom, setCustom] = useState({ baseUrl: '', model: '', modality: 'transcription', apiKey: '', label: '' });
  const [voiceDraft, setVoiceDraft] = useState<string | null>(null);
  const models = media?.models ?? [];
  const stt = models.filter(m => m.modality === 'transcription' && m.enabled);
  const tts = models.filter(m => m.modality === 'audio' && m.enabled);

  async function toggleDictation() {
    if (recorder) {
      const take = await recorder.stop().catch((err: unknown) => {
        pushToast('error', err instanceof Error ? err.message : 'Recording failed');
        return null;
      });
      setRecorder(null);
      if (!take) return;
      if (!keyData?.apiKey) {
        pushToast('error', 'Add a provider key before dictating.');
        return;
      }
      setTranscribing(true);
      try {
        const text = await transcribeAudio(take.blob, take.filename, keyData.apiKey, voice?.sttModel ?? 'auto');
        setTranscript(text.trim());
        if (!text.trim()) pushToast('info', 'Nothing transcribed — try speaking closer to the mic');
      } catch (err) {
        pushToast('error', err instanceof Error ? err.message : 'Transcription failed');
      } finally {
        setTranscribing(false);
      }
      return;
    }
    try {
      setRecorder(await startDictationRecording());
      setTranscript('');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Microphone unavailable');
    }
  }

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
      {configuredKeys === 0 && (
        <button
          type="button"
          onClick={() => setRail('keys')}
          className="mb-3 flex w-full items-center gap-2 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-left text-xs outline-none hover:bg-warn/15 focus-visible:ring-2 focus-visible:ring-accent"
        >
          <KeyRound className="size-4 shrink-0 text-warn" strokeWidth={1.5} />
          <span>
            <span className="font-semibold">Voice needs a provider key.</span>{' '}
            Dictation and read-aloud call speech models through your keys — add one on the Providers page, then come back.
          </span>
        </button>
      )}
      <div className="rounded-xl border border-line bg-base-1 p-5 text-center">
        <button
          type="button"
          aria-label={recorder ? 'Stop and transcribe' : 'Start dictation'}
          disabled={transcribing}
          onClick={() => void toggleDictation()}
          className={`mx-auto flex size-16 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 ${
            recorder ? 'animate-pulse bg-bad text-base-0' : 'bg-accent text-base-0 hover:opacity-90'
          }`}
        >
          <Mic className="size-6" strokeWidth={1.5} />
        </button>
        <p className="mt-3 text-sm font-medium">
          {transcribing ? 'Transcribing…' : recorder ? 'Tap again to stop & transcribe' : 'Tap to dictate'}
        </p>
        <p className="mt-1 font-mono text-[11px] text-ink-dim">{voice?.sttModel ?? 'auto'} · dictation model</p>
        {transcript && (
          <div className="mx-auto mt-3 flex max-w-md items-start gap-2 rounded-lg bg-base-2 p-3 text-left">
            <p className="min-w-0 flex-1 text-xs">{transcript}</p>
            <button
              type="button"
              aria-label="Copy transcript"
              onClick={() => {
                void navigator.clipboard?.writeText(transcript).then(
                  () => pushToast('ok', 'Transcript copied'),
                  () => pushToast('error', 'Copy failed'),
                );
              }}
              className="rounded-md p-1 text-ink-dim outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Copy className="size-3.5" strokeWidth={1.5} />
            </button>
          </div>
        )}
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
            <p className="text-[13px] font-medium">Voice</p>
            <p className="text-xs text-ink-dim">Provider voice id (empty = default)</p>
          </div>
          <input
            value={voiceDraft ?? voice?.ttsVoice ?? ''}
            onChange={e => setVoiceDraft(e.target.value)}
            onBlur={() => {
              if (voiceDraft !== null && voiceDraft !== (voice?.ttsVoice ?? '')) void save({ ttsVoice: voiceDraft });
              setVoiceDraft(null);
            }}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            placeholder="default"
            aria-label="TTS voice"
            className="w-40 rounded-lg border border-line bg-base-1 px-2 py-1.5 font-mono text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent"
          />
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
            <p className="text-[13px] font-medium">Announce runs</p>
            <p className="text-xs text-ink-dim">Speak run completion, failure, and approvals</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={!!voice?.autoSpeakRuns}
            aria-label="Announce runs"
            onClick={() => void save({ autoSpeakRuns: !voice?.autoSpeakRuns })}
            className={`relative h-5 w-9 shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent ${voice?.autoSpeakRuns ? 'bg-accent' : 'bg-base-2'}`}
          >
            <span className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${voice?.autoSpeakRuns ? 'left-[18px]' : 'left-0.5'}`} />
          </button>
        </div>
        <div className="flex items-center justify-between gap-3 py-3">
          <div>
            <p className="text-[13px] font-medium">Sample</p>
            <p className="text-xs text-ink-dim">Hear the current voice</p>
          </div>
          <span className="flex items-center gap-1.5">
            {playing && (
              <button
                type="button"
                onClick={() => { stopSpeech(); setPlaying(false); }}
                aria-label="Stop sample"
                className="rounded-lg border border-line px-2.5 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent"
              >
                Stop
              </button>
            )}
            <button
              type="button"
              onClick={() => void playSample()}
              className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Play className="size-3.5" strokeWidth={1.5} /> Play
            </button>
          </span>
        </div>
      </div>
      <div className="mt-3 rounded-xl border border-line bg-base-1 px-4 py-3">
        <p className="text-[13px] font-medium">Local speech server</p>
        <p className="mt-0.5 text-xs text-ink-dim">
          Keyless on-device option: point at an OpenAI-compatible endpoint (e.g. a local whisper server).
          Ollama itself serves no audio API, so local transcription goes through here.
        </p>
        <div className="mt-2 space-y-2">
          <div className="flex gap-2">
            <input value={custom.baseUrl} onChange={e => setCustom({ ...custom, baseUrl: e.target.value })} placeholder="http://127.0.0.1:8080" aria-label="Custom endpoint base URL" className="w-full rounded-lg border border-line bg-base-0 px-2.5 py-2 font-mono text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent" />
            <select value={custom.modality} onChange={e => setCustom({ ...custom, modality: e.target.value })} aria-label="Custom endpoint modality" className="rounded-lg border border-line bg-base-1 px-2 py-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent">
              <option value="transcription">transcription</option>
              <option value="audio">speech</option>
            </select>
          </div>
          <div className="flex gap-2">
            <input value={custom.model} onChange={e => setCustom({ ...custom, model: e.target.value })} placeholder="model id" aria-label="Custom endpoint model" className="w-full rounded-lg border border-line bg-base-0 px-2.5 py-2 font-mono text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent" />
            <input value={custom.apiKey} onChange={e => setCustom({ ...custom, apiKey: e.target.value })} placeholder="api key (optional)" aria-label="Custom endpoint API key" className="w-full rounded-lg border border-line bg-base-0 px-2.5 py-2 font-mono text-xs outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent" />
          </div>
          <button type="button" onClick={() => void registerCustom()} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-base-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent">Register endpoint</button>
        </div>
      </div>
    </div>
  );
}
