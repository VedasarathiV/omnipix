import { z } from 'zod';
import { getSetting, setSetting } from '../db/index.js';

// Voice-agent preferences: which speech models to use and when the dashboard
// reads aloud on its own. Stored server-side so the browser dashboard and the
// desktop app share one voice. Empty voice means "the provider's default".

const SETTING_KEY = 'voice_settings';

export const voiceSettingsSchema = z.object({
  /** Speech model id, or 'auto' for router's pick. */
  ttsModel: z.string().trim().min(1).max(120).default('auto'),
  /** Provider voice id, or '' for the default voice. */
  ttsVoice: z.string().trim().max(120).default(''),
  /** Transcription model id, or 'auto'. */
  sttModel: z.string().trim().min(1).max(120).default('auto'),
  /** Read playground replies aloud as they finish. */
  autoSpeakChat: z.boolean().default(false),
  /** Announce agent-run completions, failures, and approval requests. */
  autoSpeakRuns: z.boolean().default(false),
});

export type VoiceSettings = z.infer<typeof voiceSettingsSchema>;

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  ttsModel: 'auto',
  ttsVoice: '',
  sttModel: 'auto',
  autoSpeakChat: false,
  autoSpeakRuns: false,
};

export function getVoiceSettings(): VoiceSettings {
  const raw = getSetting(SETTING_KEY);
  if (!raw) return { ...DEFAULT_VOICE_SETTINGS };
  try {
    const parsed = voiceSettingsSchema.partial().safeParse(JSON.parse(raw));
    if (!parsed.success) return { ...DEFAULT_VOICE_SETTINGS };
    return { ...DEFAULT_VOICE_SETTINGS, ...parsed.data };
  } catch {
    return { ...DEFAULT_VOICE_SETTINGS };
  }
}

export function setVoiceSettings(patch: Partial<VoiceSettings>): VoiceSettings {
  const next = { ...getVoiceSettings(), ...patch };
  const parsed = voiceSettingsSchema.safeParse(next);
  if (!parsed.success) {
    throw new Error(`Invalid voice settings: ${parsed.error.issues.map(e => e.message).join(', ')}`);
  }
  setSetting(SETTING_KEY, JSON.stringify(parsed.data));
  return parsed.data;
}
