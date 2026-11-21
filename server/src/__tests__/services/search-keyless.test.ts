import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, getSetting, initDb } from '../../db/index.js';
import { encrypt } from '../../lib/crypto.js';
import {
  enableKeylessSearch,
  ensureKeylessEngines,
  KEYLESS_SEARCH_SETTING,
  keylessSearchEnabled,
  listSearchEngines,
  searchStatus,
} from '../../services/search.js';

// Keyless opt-in: a fresh install has no catalog engines, so the Search page
// offers one-tap anonymous search. These pin the rows it creates, the flag
// catalog-sync uses to keep them, and real-key precedence.
describe('keyless search opt-in', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
  });

  it('starts disabled with no engines', () => {
    expect(keylessSearchEnabled()).toBe(false);
    expect(listSearchEngines()).toEqual([]);
    expect(searchStatus().status).toBe('needs_configuration');
  });

  it('enables two anonymous engines and reports ready', () => {
    const out = enableKeylessSearch();
    expect(out.engines.sort()).toEqual(['keenable-search', 'parallel-search']);
    expect(getSetting(KEYLESS_SEARCH_SETTING)).toBe('1');
    expect(keylessSearchEnabled()).toBe(true);
    const engines = listSearchEngines();
    expect(engines.map(e => e.engineId).sort()).toEqual(['keenable-search', 'parallel-search']);
    expect(engines.every(e => e.healthyKeyCount === 1)).toBe(true);
    expect(out.status.status).toBe('ready');
    expect(searchStatus().status).toBe('ready');
  });

  it('is idempotent', () => {
    enableKeylessSearch();
    enableKeylessSearch();
    const db = getDb();
    expect(db.prepare("SELECT COUNT(*) AS n FROM media_models WHERE modality = 'search'").get()).toMatchObject({ n: 2 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM api_keys WHERE platform IN ('parallel', 'keenable')").get()).toMatchObject({ n: 2 });
  });

  it('keeps a real key instead of adding the sentinel', () => {
    const { encrypted, iv, authTag } = encrypt('parallel-real-key');
    getDb().prepare(`
      INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
      VALUES ('parallel', 'mine', ?, ?, ?, 'healthy', 1)
    `).run(encrypted, iv, authTag);
    enableKeylessSearch();
    const rows = getDb().prepare('SELECT label FROM api_keys WHERE platform = ?').all('parallel') as { label: string }[];
    expect(rows).toEqual([{ label: 'mine' }]);
    expect(searchStatus().status).toBe('ready');
  });

  it('re-adds rows after a catalog prune wiped them', () => {
    enableKeylessSearch();
    const db = getDb();
    // Simulate catalog-sync pruning non-catalog engines on a version bump.
    db.prepare("DELETE FROM media_models WHERE modality = 'search'").run();
    expect(listSearchEngines()).toEqual([]);
    expect(ensureKeylessEngines().sort()).toEqual(['keenable-search', 'parallel-search']);
    expect(listSearchEngines().map(e => e.engineId).sort()).toEqual(['keenable-search', 'parallel-search']);
  });

  it('leaves a locally disabled engine off', () => {
    enableKeylessSearch();
    const db = getDb();
    db.prepare("UPDATE media_models SET enabled = 0 WHERE model_id = 'parallel-search'").run();
    ensureKeylessEngines();
    const row = db.prepare("SELECT enabled FROM media_models WHERE model_id = 'parallel-search'").get() as { enabled: number };
    expect(row.enabled).toBe(0);
  });
});
