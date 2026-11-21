import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, getSetting, initDb } from '../../db/index.js';
import {
  enableKeylessMedia,
  ensureKeylessMedia,
  KEYLESS_MEDIA_SETTING,
  keylessMediaEnabled,
  listMediaModels,
} from '../../services/media.js';

// Keyless media opt-in: fresh installs have no image rows and no anonymous
// audio rows, so chat generation modes would 503. Video is excluded on
// purpose — every video adapter needs a real key.
describe('keyless media opt-in', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
  });

  it('starts disabled with no image rows', () => {
    expect(keylessMediaEnabled()).toBe(false);
    expect(listMediaModels('image')).toEqual([]);
  });

  it('enables anonymous image + audio rows', () => {
    const out = enableKeylessMedia();
    expect(out.models.sort()).toEqual(['flux', 'openai-audio']);
    expect(getSetting(KEYLESS_MEDIA_SETTING)).toBe('1');
    expect(keylessMediaEnabled()).toBe(true);
    const images = listMediaModels('image');
    expect(images.map(r => `${r.platform}:${r.model_id}`)).toEqual(['pollinations:flux']);
    const audio = listMediaModels('audio');
    expect(audio.map(r => `${r.platform}:${r.model_id}`)).toContain('pollinations:openai-audio');
    expect(listMediaModels('video')).toEqual([]);
  });

  it('is idempotent', () => {
    enableKeylessMedia();
    enableKeylessMedia();
    const db = getDb();
    expect(db.prepare("SELECT COUNT(*) AS n FROM media_models WHERE platform = 'pollinations'").get()).toMatchObject({ n: 2 });
  });

  it('keeps operator rows and leaves disabled rows off', () => {
    const db = getDb();
    db.prepare(`
      INSERT INTO media_models (platform, model_id, display_name, modality, priority, enabled, quota_label, meta_json)
      VALUES ('pollinations', 'flux', 'Mine', 'image', 0, 0, '', '{}')
    `).run();
    expect(ensureKeylessMedia().sort()).toEqual(['flux', 'openai-audio']);
    const row = db.prepare("SELECT enabled, display_name AS name FROM media_models WHERE model_id = 'flux'").get() as { enabled: number; name: string };
    expect(row).toMatchObject({ enabled: 0, name: 'Mine' });
  });
});
