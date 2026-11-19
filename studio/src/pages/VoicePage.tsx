import { useState } from 'react';
import { Mic, Play } from 'lucide-react';
import { useStudio } from '../state/store';

export function VoicePage() {
  const { pushToast } = useStudio();
  const [listening, setListening] = useState(false);
  return (
    <div className="mx-auto max-w-2xl px-5 py-4">
      <h1 className="mb-4 text-lg font-semibold">Voice</h1>
      <div className="rounded-xl border border-line bg-base-1 p-5 text-center">
        <button
          type="button"
          aria-label={listening ? 'Stop dictation' : 'Start dictation'}
          onClick={() => {
            setListening(l => !l);
            if (!listening) pushToast('info', 'Listening… (mock dictation)');
          }}
          className={`mx-auto flex size-16 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            listening ? 'animate-pulse bg-bad text-base-0' : 'bg-accent text-base-0 hover:opacity-90'
          }`}
        >
          <Mic className="size-6" strokeWidth={1.5} />
        </button>
        <p className="mt-3 text-sm font-medium">{listening ? 'Listening…' : 'Tap to dictate'}</p>
        <p className="mt-1 font-mono text-[11px] text-ink-dim">whisper-large-v3-turbo · groq</p>
      </div>
      <div className="mt-3 divide-y divide-line rounded-xl border border-line bg-base-1 px-4">
        <div className="flex items-center justify-between py-3">
          <div>
            <p className="text-[13px] font-medium">Speech model</p>
            <p className="text-xs text-ink-dim">Text-to-speech voice for read-aloud</p>
          </div>
          <span className="font-mono text-xs text-ink-dim">sonic-3</span>
        </div>
        <div className="flex items-center justify-between py-3">
          <div>
            <p className="text-[13px] font-medium">Sample</p>
            <p className="text-xs text-ink-dim">Hear the current voice</p>
          </div>
          <button
            type="button"
            onClick={() => pushToast('ok', 'Playing voice sample')}
            className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs outline-none hover:bg-base-2 focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Play className="size-3.5" strokeWidth={1.5} /> Play
          </button>
        </div>
      </div>
    </div>
  );
}
