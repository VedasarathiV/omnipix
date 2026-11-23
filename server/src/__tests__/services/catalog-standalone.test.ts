import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initDb, setSetting } from '../../db/index.js';
import {
  catalogBaseUrl,
  refreshLicenseStatus,
  SETTING_LICENSE_KEY,
  syncCatalog,
  validateLicenseKey,
} from '../../services/catalog-sync.js';

// Standalone mode: with no CATALOG_BASE_URL the install serves its bundled
// catalog and every catalog-service call is a quiet no-op — no network, no
// error rows, no throw. These tests pin that contract.

describe('catalog-sync standalone mode (no CATALOG_BASE_URL)', () => {
  const savedBase = process.env.CATALOG_BASE_URL;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    delete process.env.CATALOG_BASE_URL;
    initDb(':memory:');
  });

  afterAll(() => {
    if (savedBase === undefined) delete process.env.CATALOG_BASE_URL;
    else process.env.CATALOG_BASE_URL = savedBase;
  });

  it('defaults to an empty feed URL', () => {
    expect(catalogBaseUrl()).toBe('');
  });

  it('syncCatalog no-ops without touching the network', async () => {
    const result = await syncCatalog();
    expect(result.ok).toBe(false);
    expect(result.action).toBe('error');
    expect(result.detail).toMatch(/not configured/i);
  });

  it('validateLicenseKey returns null (reads as unreachable)', async () => {
    await expect(validateLicenseKey('any-key')).resolves.toBeNull();
  });

  it('refreshLicenseStatus keeps the cached status without a service', async () => {
    expect(await refreshLicenseStatus()).toBeNull();
    setSetting(SETTING_LICENSE_KEY, 'stored-key');
    expect(await refreshLicenseStatus()).toBeNull();
  });
});
