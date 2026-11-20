import { getDb, getSetting, setSetting } from '../db/index.js';
import {
  applyCatalog,
  catalogShapeProblems,
  MIN_CATALOG_VERSION,
  SETTING_APPLIED_JSON,
  SETTING_APPLIED_TIER,
  SETTING_APPLIED_VERSION,
  verifyCatalogBytes,
  type Catalog,
} from './catalog-sync.js';
import {
  BUNDLED_CATALOG_BYTES,
  BUNDLED_CATALOG_SIGNATURE,
  BUNDLED_CATALOG_TIER,
  BUNDLED_CATALOG_VERSION,
} from '../generated/bundled-catalog.js';

// Bundled catalog snapshot: the signed feed document shipped inside the app.
// Standalone installs have no feed URL, so without this they would only ever
// see the small bundled-migration baseline. This applies the snapshot through
// the SAME verified path as a network sync — signature check, shape check,
// version guard, applyCatalog — so feed-gated platforms keep their gating and
// the bundled migrations stay the floor. Runs once per version per DB; later
// app releases ship a newer snapshot that applies on upgrade.
//
// Named load* so the desktop boot-mirror test (#949) enforces the embedder
// call. Never throws: a bad snapshot must not take the server down.

export interface BundledCatalogResult {
  applied: boolean;
  reason: 'applied' | 'up_to_date' | 'skipped_older' | 'bad_signature' | 'bad_shape' | 'error';
  detail?: string;
}

export function loadBundledCatalog(): BundledCatalogResult {
  try {
    const db = getDb();
    const appliedVersion = getSetting(SETTING_APPLIED_VERSION);
    if (appliedVersion === BUNDLED_CATALOG_VERSION && getSetting(SETTING_APPLIED_TIER) === BUNDLED_CATALOG_TIER) {
      return { applied: false, reason: 'up_to_date' };
    }
    const bytes = Buffer.from(BUNDLED_CATALOG_BYTES, 'utf8');
    if (!verifyCatalogBytes(bytes, BUNDLED_CATALOG_SIGNATURE)) {
      console.warn('[bundled-catalog] snapshot signature FAILED — keeping the bundled baseline');
      return { applied: false, reason: 'bad_signature' };
    }
    const parsed: unknown = JSON.parse(bytes.toString('utf8'));
    const shapeProblems = catalogShapeProblems(parsed);
    if (shapeProblems.length > 0) {
      console.warn(`[bundled-catalog] snapshot has unexpected shape: ${shapeProblems.join('; ')}`);
      return { applied: false, reason: 'bad_shape' };
    }
    const catalog = parsed as Catalog;
    if (catalog.version < MIN_CATALOG_VERSION) {
      return { applied: false, reason: 'skipped_older', detail: catalog.version };
    }
    const counts = applyCatalog(db, catalog);
    setSetting(SETTING_APPLIED_VERSION, catalog.version);
    setSetting(SETTING_APPLIED_TIER, catalog.tier);
    setSetting(SETTING_APPLIED_JSON, bytes.toString('utf8'));
    console.log(
      `[bundled-catalog] applied ${catalog.tier} v${catalog.version}: ` +
        `${counts.updated} updated, ${counts.inserted} new, ${counts.removed} removed`,
    );
    return { applied: true, reason: 'applied' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[bundled-catalog] ${message} — keeping the bundled baseline`);
    return { applied: false, reason: 'error', detail: message };
  }
}
