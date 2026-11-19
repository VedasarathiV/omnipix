/**
 * export-catalog — build the catalog feed document from the live omnipix DB.
 *
 * This is the single source of truth pipeline: every model and quirk comes
 * straight out of the same SQLite DB the router uses, so the published feed
 * can never drift from what the gateway actually serves. Pipe the output
 * through sign-catalog.ts, then serve it with serve-catalog.ts (local) or any
 * static host that can set the x-catalog-signature response header.
 * Full runbook: ./catalog-feed.md
 *
 * Usage:
 *   tsx src/scripts/export-catalog.ts [--db <path>] [--out <path>]
 *                                     [--version <YYYY.MM.DD>] [--tier live|monthly]
 *                                     [--stdout]
 */
import fs from 'fs';
import { initDb, getDb } from '../db/index.js';
import { exportCatalogDocument } from '../services/catalog-feed.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function dateVersion(d = new Date()): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}.${mm}.${dd}`;
}

function main() {
  const dbPath = arg('db');
  const tier = (arg('tier') as 'live' | 'monthly' | undefined) ?? 'live';
  if (tier !== 'live' && tier !== 'monthly') {
    console.error(`--tier must be live or monthly, got ${JSON.stringify(arg('tier'))}`);
    process.exit(1);
  }
  const version = arg('version') ?? dateVersion();

  // In --stdout mode stdout must carry ONLY the JSON document; incidental
  // logs (e.g. initDb's "Database initialized at ...") go to stderr instead.
  if (flag('stdout')) console.log = console.error;

  initDb(dbPath);
  const catalog = exportCatalogDocument(getDb(), { version, tier });
  const json = JSON.stringify(catalog, null, 2) + '\n';

  if (flag('stdout')) {
    process.stdout.write(json);
    return;
  }

  const outPath = arg('out') ?? `catalog.${tier}.json`;
  fs.writeFileSync(outPath, json);
  console.log(
    `Wrote ${tier} catalog ${version}: ${catalog.models.length} chat/media models, ` +
      `${catalog.embeddings?.length ?? 0} embeddings, ` +
      `${catalog.transcriptionModels?.length ?? 0} transcription, ` +
      `${catalog.videoModels?.length ?? 0} video, ${catalog.searchEngines?.length ?? 0} search, ` +
      `${catalog.decisionModels?.length ?? 0} decision, ${catalog.quirks.length} quirks -> ${outPath}`,
  );
}

main();
