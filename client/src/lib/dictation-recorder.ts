import { pickRecordingMimeType, recordingFilename } from './transcription'

// A single microphone recording: MediaRecorder capture with the shared mime
// preference order, returned as a stoppable handle. The caller owns when to
// stop; transcription/upload stays with the caller too so this module works
// for the composer button and the global hotkey alike.

export interface DictationRecorder {
  /** Stop capture and resolve with the recorded clip. */
  stop: () => Promise<{ blob: Blob; filename: string }>
  /** Abandon the take: stop tracks without resolving audio. */
  cancel: () => void
}

export async function startDictationRecording(): Promise<DictationRecorder> {
  if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('MediaRecorder is not supported in this browser')
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const mimeType = pickRecordingMimeType(type => MediaRecorder.isTypeSupported(type))
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
  const chunks: Blob[] = []
  recorder.ondataavailable = (e: BlobEvent) => { if (e.data.size > 0) chunks.push(e.data) }
  const stopped = new Promise<{ blob: Blob; filename: string }>((resolve, reject) => {
    recorder.onstop = () => {
      stream.getTracks().forEach(track => track.stop())
      resolve({ blob: new Blob(chunks, { type: mimeType ?? 'audio/webm' }), filename: recordingFilename(mimeType) })
    }
    recorder.onerror = () => {
      stream.getTracks().forEach(track => track.stop())
      reject(new Error('recording failed'))
    }
  })
  recorder.start()
  return {
    stop: () => {
      if (recorder.state !== 'inactive') recorder.stop()
      return stopped
    },
    cancel: () => {
      try { if (recorder.state !== 'inactive') recorder.stop() } catch { /* already stopped */ }
      stream.getTracks().forEach(track => track.stop())
    },
  }
}
