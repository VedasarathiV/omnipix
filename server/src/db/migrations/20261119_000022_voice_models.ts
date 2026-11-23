// Migration: seed fallback voice (STT/TTS) models.
//
// The media registry previously arrived ONLY via catalog sync, which is
// unset on local-first installs — so transcription and speech could never
// work out of the box, and the mic failed with a sync lecture. Chat models
// have always shipped a seeded fallback list; voice gets the same. Every
// id here is validated by its adapter in services/media.ts, and catalog
// sync still overlays fresher rows afterward. INSERT OR IGNORE keeps this
// idempotent with sync and re-runs.
import type { Db } from '../types.js';

const ROWS: Array<[string, string, string, string, number, string]> = [
  // [platform, model_id, display_name, modality, priority, quota_label]
  ['groq', 'whisper-large-v3-turbo', 'Whisper Large v3 Turbo', 'transcription', 10, 'Free tier'],
  ['ovh', 'whisper-large-v3-turbo', 'Whisper Large v3 Turbo (OVH)', 'transcription', 20, 'Keyless'],
  ['freeai', 'whisper', 'Whisper (Free.ai)', 'transcription', 30, 'Free tier'],
  ['groq', 'canopylabs/orpheus-v1-english', 'Orpheus English', 'audio', 10, 'Free tier'],
  ['freeai', 'kokoro', 'Kokoro', 'audio', 20, 'Free tier'],
  ['cartesia', 'sonic-3', 'Sonic 3', 'audio', 30, 'Free tier'],
];

export function up(db: Db): void {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO media_models (platform, model_id, display_name, modality, priority, enabled, quota_label)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `);
  const apply = db.transaction(() => {
    for (const [platform, modelId, displayName, modality, priority, quota] of ROWS) {
      insert.run(platform, modelId, displayName, modality, priority, quota);
    }
  });
  apply();
}

export function down(db: Db): void {
  const remove = db.prepare('DELETE FROM media_models WHERE platform = ? AND model_id = ?');
  const apply = db.transaction(() => {
    for (const [platform, modelId] of ROWS) {
      remove.run(platform, modelId);
    }
    // media_models is AUTOINCREMENT: without this the sequence survives the
    // delete and a re-up lands on new ids. Resetting is collision-safe —
    // SQLite recomputes max(rowid)+1 when no sequence row exists.
    db.prepare("DELETE FROM sqlite_sequence WHERE name = 'media_models'").run();
  });
  apply();
}
