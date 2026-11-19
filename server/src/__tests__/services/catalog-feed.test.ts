import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { initDb, getDb } from '../../db/index.js';
import {
  applyCatalog,
  catalogShapeProblems,
  syncCatalog,
} from '../../services/catalog-sync.js';
import {
  createFeedServer,
  exportCatalogDocument,
  generateFeedKeypair,
  signCatalogBytes,
  verifyCatalogBytes,
} from '../../services/catalog-feed.js';

const VERSION = '2999.01.01';

describe('catalog-feed signing', () => {
  it('round-trips sign/verify and rejects tampered bytes', () => {
    const { publicKeyPem, privateKeyPem } = generateFeedKeypair();
    const bytes = Buffer.from('{"version":"2999.01.01"}', 'utf8');
    const sig = signCatalogBytes(bytes, privateKeyPem);
    expect(verifyCatalogBytes(bytes, sig, publicKeyPem)).toBe(true);
    expect(verifyCatalogBytes(Buffer.from('{"version":"2999.01.02"}', 'utf8'), sig, publicKeyPem)).toBe(false);
    expect(verifyCatalogBytes(bytes, 'not-base64!!!', publicKeyPem)).toBe(false);
  });
});

describe('catalog-feed export', () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
  });

  it('exports a shape-clean document covering every registry', () => {
    const doc = exportCatalogDocument(getDb(), { version: VERSION, tier: 'live' });
    expect(catalogShapeProblems(doc)).toEqual([]);
    expect(doc.models.length).toBeGreaterThan(0);
    expect(doc.quirks.length).toBeGreaterThan(0);
    // User rows and custom-platform rows are local data, never published.
    expect(doc.models.some((m) => m.platform === 'custom')).toBe(false);
  });

  it('excludes user-added rows from the published document', () => {
    getDb()
      .prepare(
        `INSERT INTO models (platform, model_id, display_name, intelligence_rank, speed_rank, size_label,
                             enabled, supports_vision, supports_tools, source)
         VALUES ('groq', 'my-private-model', 'Mine', 1, 1, 'S', 1, 0, 0, 'user')`,
      )
      .run();
    const doc = exportCatalogDocument(getDb(), { version: VERSION, tier: 'live' });
    expect(doc.models.some((m) => m.modelId === 'my-private-model')).toBe(false);
    getDb().prepare("DELETE FROM models WHERE model_id = 'my-private-model'").run();
  });

  it('is the inverse of applyCatalog: wipe + apply restores every row', () => {
    const db = getDb();
    const doc = exportCatalogDocument(db, { version: VERSION, tier: 'live' });
    const chatCount = doc.models.filter((m) => !m.modality || m.modality === 'text').length;
    db.prepare("DELETE FROM fallback_config WHERE model_db_id IN (SELECT id FROM models WHERE source = 'catalog')").run();
    db.prepare("DELETE FROM models WHERE source = 'catalog'").run();
    const counts = applyCatalog(db, doc);
    expect(counts.inserted).toBeGreaterThanOrEqual(chatCount);
    expect(
      (db.prepare("SELECT COUNT(*) AS c FROM models WHERE source = 'catalog'").get() as { c: number }).c,
    ).toBe(chatCount);
  });
});

describe('catalog-feed server + syncCatalog end to end', () => {
  const savedBase = process.env.CATALOG_BASE_URL;
  const savedPubkey = process.env.CATALOG_PUBKEY;
  const servers: Array<{ close: (cb?: () => void) => void }> = [];

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
  });

  afterEach(async () => {
    for (const s of servers.splice(0)) await new Promise<void>((resolve) => s.close(() => resolve()));
  });

  afterAll(() => {
    if (savedBase === undefined) delete process.env.CATALOG_BASE_URL;
    else process.env.CATALOG_BASE_URL = savedBase;
    if (savedPubkey === undefined) delete process.env.CATALOG_PUBKEY;
    else process.env.CATALOG_PUBKEY = savedPubkey;
  });

  it('serves a signed feed that syncCatalog applies, then short-circuits', async () => {
    const { publicKeyPem, privateKeyPem } = generateFeedKeypair();
    const doc = exportCatalogDocument(getDb(), { version: VERSION, tier: 'live' });
    doc.models.push({
      platform: 'groq',
      modelId: 'feed-e2e-probe',
      displayName: 'Feed E2E Probe',
      intelligenceRank: 1,
      speedRank: 1,
      sizeLabel: 'S',
      limits: { rpm: null, rpd: null, tpm: null, tpd: null },
      monthlyTokenBudget: '10M',
      contextWindow: null,
      enabled: true,
      supportsVision: false,
      supportsTools: false,
    });
    const bytes = Buffer.from(JSON.stringify(doc), 'utf8');
    const feed = await createFeedServer({ version: VERSION, bytes, signatureB64: signCatalogBytes(bytes, privateKeyPem) });
    servers.push(feed.server);
    process.env.CATALOG_BASE_URL = feed.url;
    process.env.CATALOG_PUBKEY = publicKeyPem;

    const first = await syncCatalog();
    expect(first.action).toBe('applied');
    expect(
      getDb().prepare("SELECT id FROM models WHERE platform = 'groq' AND model_id = 'feed-e2e-probe'").get(),
    ).toBeTruthy();

    const second = await syncCatalog();
    expect(second.action).toBe('up_to_date');
  });

  it('rejects a feed signed with the wrong key', async () => {
    const good = generateFeedKeypair();
    const evil = generateFeedKeypair();
    const doc = exportCatalogDocument(getDb(), { version: '2999.02.02', tier: 'live' });
    const bytes = Buffer.from(JSON.stringify(doc), 'utf8');
    const feed = await createFeedServer({ version: '2999.02.02', bytes, signatureB64: signCatalogBytes(bytes, evil.privateKeyPem) });
    servers.push(feed.server);
    process.env.CATALOG_BASE_URL = feed.url;
    process.env.CATALOG_PUBKEY = good.publicKeyPem;

    const result = await syncCatalog();
    expect(result.action).toBe('error');
    expect(result.detail).toMatch(/signature/i);
  });
});
