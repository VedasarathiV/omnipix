import { useState } from 'react';
import { Mic } from 'lucide-react';
import { useStudio } from '../state/store';
import { startDictationRecording, transcribeAudio, type DictationRecorder } from '../lib/voice';
import { useUnifiedKey, useVoiceSettings } from '../lib/queries';

/** Floating dictation button, anchored to the chat pane. Takes land in the input. */
export function FloatingMic() {
  const { pushToast, setDictation, setRail } = useStudio();
  const { data: keyData } = useUnifiedKey();
  const { data: voiceSettings } = useVoiceSettings();
  const [recorder, setRecorder] = useState<DictationRecorder | null>(null);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (recorder) {
      const take = await recorder.stop().catch(() => null);
      setRecorder(null);
      if (!take) return;
      if (!keyData?.apiKey) {
        pushToast('error', 'Add a provider key before dictating.');
        return;
      }
      setBusy(true);
      try {
        const text = await transcribeAudio(take.blob, take.filename, keyData.apiKey, voiceSettings?.sttModel ?? 'auto');
        if (text.trim()) {
          setDictation({ text: text.trim(), seq: Date.now() });
          setRail('chat');
        }
      } catch (err) {
        pushToast('error', err instanceof Error ? err.message : 'Transcription failed');
      } finally {
        setBusy(false);
      }
      return;
    }
    try {
      setRecorder(await startDictationRecording());
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Microphone unavailable');
    }
  }

  return (
    <button
      type="button"
      title={recorder ? 'Stop and transcribe' : 'Dictate (mic)'}
      aria-label={recorder ? 'Stop and transcribe' : 'Dictate'}
      onClick={() => void toggle()}
      disabled={busy}
      className={`absolute right-5 bottom-40 z-30 hidden size-11 items-center justify-center rounded-full border shadow-xl outline-none focus-visible:ring-2 focus-visible:ring-accent md:flex ${
        recorder ? 'animate-pulse border-bad bg-bad/20' : 'border-line bg-base-1 hover:bg-base-2'
      }`}
    >
      <Mic className={`size-5 ${recorder ? 'text-bad' : 'text-ink-dim'}`} strokeWidth={1.5} />
    </button>
  );
}
