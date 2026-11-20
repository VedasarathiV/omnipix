import { describe, it, expect, beforeEach } from 'vitest';
import { initDb, getDb, getSetting } from '../../db/index.js';
import { loadBundledCatalog } from '../../services/bundled-catalog.js';
import { verifyCatalogBytes } from '../../services/catalog-sync.js';
import {
  BUNDLED_CATALOG_BYTES,
  BUNDLED_CATALOG_SIGNATURE,
  BUNDLED_CATALOG_VERSION,
} from '../../generated/bundled-catalog.js';

describe('bundled catalog snapshot', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
  });

  it('applies the snapshot on first boot and records its version', () => {
    const before = (getDb().prepare('SELECT COUNT(*) AS c FROM models').get() as { c: number }).c;
    const result = loadBundledCatalog();
    expect(result).toMatchObject({ applied: true, reason: 'applied' });
    const after = getDb().prepare('SELECT COUNT(*) AS c, COUNT(DISTINCT platform) AS p FROM models').get() as { c: number; p: number };
    expect(after.c).toBeGreaterThan(before);
    expect(after.c).toBeGreaterThanOrEqual(550);
    expect(after.p).toBeGreaterThanOrEqual(45);
    expect(getSetting('catalog_applied_version')).toBe(BUNDLED_CATALOG_VERSION);
    expect(getSetting('catalog_applied_tier')).toBe('live');
    // Chain invariant holds for every applied row.
    const missing = getDb().prepare(
      'SELECT COUNT(*) AS c FROM models m LEFT JOIN fallback_config f ON m.id = f.model_db_id WHERE f.id IS NULL',
    ).get() as { c: number };
    expect(missing.c).toBe(0);
  });

  it('is idempotent: a second boot is up_to_date', () => {
    expect(loadBundledCatalog().reason).toBe('applied');
    const again = loadBundledCatalog();
    expect(again).toMatchObject({ applied: false, reason: 'up_to_date' });
  });

  it('keeps user rows while applying the snapshot', () => {
    getDb().prepare(
      "INSERT INTO models (platform, model_id, display_name, intelligence_rank, speed_rank, source) VALUES ('custom', 'mine', 'Mine', 1, 1, 'user')",
    ).run();
    loadBundledCatalog();
    const row = getDb().prepare("SELECT id FROM models WHERE platform = 'custom' AND model_id = 'mine'").get();
    expect(row).toBeTruthy();
  });

  it('verifies the embedded signature and fails closed on tampered bytes', () => {
    const bytes = Buffer.from(BUNDLED_CATALOG_BYTES, 'utf8');
    expect(verifyCatalogBytes(bytes, BUNDLED_CATALOG_SIGNATURE)).toBe(true);
    const tampered = Buffer.from(bytes);
    tampered[tampered.length - 10] ^= 0xff;
    expect(verifyCatalogBytes(tampered, BUNDLED_CATALOG_SIGNATURE)).toBe(false);
    expect(verifyCatalogBytes(bytes, 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==')).toBe(false);
  });
});
