/**
 * serve-catalog — serve a signed catalog document as a feed origin (local/test).
 *
 * Serves GET /v1/latest with the x-catalog-signature header and honors
 * ?since= for 304 short-circuits — the exact wire contract syncCatalog
 * expects. For production, any static host that can set one response header
 * works (see ./catalog-feed.md); this server is for local feeds and tests.
 *
 * Usage:
 *   tsx src/scripts/serve-catalog.ts --file catalog.live.json --sig catalog.live.json.sig [--port 0]
 */
import fs from 'fs';
import { createFeedServer } from '../services/catalog-feed.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const file = arg('file');
  const sig = arg('sig');
  if (!file || !sig) {
    console.error('Usage: serve-catalog.ts --file <catalog.json> --sig <catalog.json.sig> [--port N]');
    process.exit(1);
  }
  const bytes = fs.readFileSync(file);
  const version = (JSON.parse(bytes.toString('utf8')) as { version?: unknown }).version;
  if (typeof version !== 'string') {
    console.error('Catalog document has no string version.');
    process.exit(1);
  }
  const { url } = await createFeedServer(
    { version, bytes, signatureB64: fs.readFileSync(sig, 'utf8').trim() },
    Number(arg('port') ?? 0),
  );
  console.log(`Serving catalog ${version} at ${url}/v1/latest (point CATALOG_BASE_URL at ${url})`);
}

void main();
