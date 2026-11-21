// Voice I/O against the gateway media endpoints: MediaRecorder capture,
// /v1/audio/transcriptions upload, /v1/audio/speech playback.

export interface DictationRecorder {
  stop: () => Promise<{ blob: Blob; filename: string }>;
  cancel: () => void;
}

const MIME_ORDER = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];

export async function startDictationRecording(): Promise<DictationRecorder> {
  if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('MediaRecorder is not supported here');
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = MIME_ORDER.find(t => MediaRecorder.isTypeSupported(t));
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e: BlobEvent) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const stopped = new Promise<{ blob: Blob; filename: string }>((resolve, reject) => {
    recorder.onstop = () => {
      stream.getTracks().forEach(track => track.stop());
      const ext = (mimeType ?? '').includes('mp4') ? 'm4a' : 'webm';
      resolve({ blob: new Blob(chunks, { type: mimeType ?? 'audio/webm' }), filename: `dictation.${ext}` });
    };
    recorder.onerror = () => {
      stream.getTracks().forEach(track => track.stop());
      reject(new Error('recording failed'));
    };
  });
  recorder.start();
  return {
    stop: () => {
      if (recorder.state !== 'inactive') recorder.stop();
      return stopped;
    },
    cancel: () => {
      try {
        if (recorder.state !== 'inactive') recorder.stop();
      } catch {
        // Already stopped.
      }
      stream.getTracks().forEach(track => track.stop());
    },
  };
}

export async function transcribeAudio(blob: Blob, filename: string, apiKey: string, model: string): Promise<string> {
  if (blob.size === 0) throw new Error('nothing was recorded');
  const form = new FormData();
  form.append('file', blob, filename);
  // Pass the selection through untouched: the server auto-routes exactly
  // 'auto' (and whisper-1). Rewriting it to a concrete id 400s when that
  // model row is absent.
  form.append('model', model && model.trim() ? model.trim() : 'auto');
  form.append('response_format', 'json');
  const res = await fetch('/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message || `HTTP ${res.status}`);
  }
  const data = (await res.json()) as { text?: string };
  return data.text ?? '';
}

let currentAudio: HTMLAudioElement | null = null;
let currentUrl: string | null = null;

export function stopSpeech(): void {
  currentAudio?.pause();
  currentAudio = null;
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
}

/** Speak text through gateway TTS. Resolves when playback finishes. */
export async function speakText(text: string, apiKey: string, model?: string, voice?: string): Promise<void> {
  stopSpeech();
  const input = text.trim();
  if (!input) return;
  const res = await fetch('/v1/audio/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      input: input.slice(0, 2000),
      ...(model && model !== 'auto' ? { model } : {}),
      ...(voice ? { voice } : {}),
    }),
  });
  if (!res.ok) {
    const detail = await res
      .json()
      .then((data: unknown) => (data as { error?: { message?: string } })?.error?.message)
      .catch(() => undefined);
    throw new Error(detail || 'speech synthesis failed');
  }
  const url = URL.createObjectURL(await res.blob());
  currentUrl = url;
  const audio = new Audio(url);
  currentAudio = audio;
  await new Promise<void>((resolve, reject) => {
    audio.onended = () => resolve();
    audio.onerror = () => reject(new Error('playback failed'));
    void audio.play().catch(() => reject(new Error('playback blocked')));
  });
  stopSpeech();
}
