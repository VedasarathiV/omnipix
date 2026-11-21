import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, getSetting, initDb, setSetting } from '../../db/index.js';
import {
  applyKeylessDefaults,
  availableKeylessProviders,
  dismissAvailableKeylessProviders,
  enableAvailableKeylessProviders,
  keylessPlatformsInCatalog,
} from '../../services/keyless-defaults.js';

// No-key chat providers are on by default for new installs, limited to what
// the install's catalog lists, and never re-added once removed.

const CATALOG = {
  models: [
    { platform: 'kilo', enabled: true },
    { platform: 'ovh', enabled: true },
    { platform: 'groq', enabled: true },
  ],
  embeddings: [{ platform: 'ovh', enabled: true }],
};

const platforms = () =>
  (getDb().prepare('SELECT platform FROM api_keys ORDER BY platform').all() as { platform: string }[]).map(r => r.platform);

describe('no-key providers by default', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
  });

  it('marks a database created from scratch as a new install', () => {
    expect(getSetting('keyless_defaults')).toBe('pending');
  });

  it('only counts no-key platforms with enabled rows in the catalog', () => {
    expect(keylessPlatformsInCatalog(CATALOG)).toEqual(['kilo', 'ovh']);
    expect(keylessPlatformsInCatalog({ models: [{ platform: 'kilo', enabled: false }] })).toEqual([]);
  });

  it('a new install gets what its catalog lists, then is done', () => {
    expect(applyKeylessDefaults(CATALOG)).toEqual(['kilo', 'ovh']);
    expect(platforms()).toEqual(['kilo', 'ovh']);
    expect(getSetting('keyless_defaults')).toBe('done');
  });

  it('runs once: a provider the user removed is not added back by a later sync', () => {
    applyKeylessDefaults(CATALOG);
    getDb().prepare("DELETE FROM api_keys WHERE platform = 'kilo'").run();
    expect(applyKeylessDefaults(CATALOG)).toEqual([]);
    expect(platforms()).not.toContain('kilo');
  });

  it('an existing install enables nothing on its own', () => {
    setSetting('keyless_defaults', 'skip');
    expect(applyKeylessDefaults(CATALOG)).toEqual([]);
    expect(platforms()).toEqual([]);
  });

  it('skips platforms that already have a key row', () => {
    getDb().prepare(`
      INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
      VALUES ('kilo', 'mine', 'e', 'i', 't', 'unknown', 0)
    `).run();
    expect(applyKeylessDefaults(CATALOG)).toEqual(['ovh']);
  });

  it('the notice counts, enables, and dismisses available providers', () => {
    setSetting('keyless_defaults', 'skip');
    setSetting('catalog_applied_json', JSON.stringify(CATALOG));
    expect(availableKeylessProviders().map(p => p.platform)).toEqual(['kilo', 'ovh']);
    dismissAvailableKeylessProviders();
    expect(availableKeylessProviders()).toEqual([]);
    setSetting('keyless_notice_dismissed', '[]');
    expect(enableAvailableKeylessProviders()).toEqual(['kilo', 'ovh']);
    expect(availableKeylessProviders()).toEqual([]);
  });

  it('returns nothing when no catalog has applied yet', () => {
    expect(availableKeylessProviders()).toEqual([]);
    expect(enableAvailableKeylessProviders()).toEqual([]);
  });
});
