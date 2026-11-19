/**
 * sign-catalog — sign a catalog feed document with the operator's Ed25519 key.
 *
 * The signature covers the EXACT bytes served: sign after the final write and
 * serve those bytes untouched. The private key is read from a file (or
 * CATALOG_FEED_SIGNING_KEY) and never logged.
 *
 * Usage:
 *   tsx src/scripts/sign-catalog.ts --in catalog.live.json --key /path/to/feed-priv.pem [--out catalog.live.json.sig]
 *   tsx src/scripts/sign-catalog.ts --keygen [--out-dir /path]   # mint a fresh feed keypair
 */
import crypto from 'crypto';
import fs from 'fs';
import { generateFeedKeypair, signCatalogBytes } from '../services/catalog-feed.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function main() {
  if (process.argv.includes('--keygen')) {
    const { publicKeyPem, privateKeyPem } = generateFeedKeypair();
    const outDir = arg('out-dir') ?? '.';
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(`${outDir}/feed-priv.pem`, privateKeyPem, { mode: 0o600 });
    fs.writeFileSync(`${outDir}/feed-pub.pem`, publicKeyPem);
    console.log(`Wrote ${outDir}/feed-priv.pem (mode 600 — back it up, never commit it)`);
    console.log(`Wrote ${outDir}/feed-pub.pem (pin this in catalog-sync.ts or set CATALOG_PUBKEY)`);
    console.log('Public key fingerprint:', crypto.createHash('sha256').update(publicKeyPem).digest('hex').slice(0, 16));
    return;
  }

  const inPath = arg('in');
  if (!inPath) {
    console.error('Usage: sign-catalog.ts --in <catalog.json> --key <feed-priv.pem> [--out <file.sig>]');
    process.exit(1);
  }
  const keyPath = arg('key');
  const privateKeyPem = keyPath
    ? fs.readFileSync(keyPath, 'utf8')
    : (process.env.CATALOG_FEED_SIGNING_KEY ?? '').replace(/\\n/g, '\n');
  if (!privateKeyPem) {
    console.error('No signing key: pass --key <feed-priv.pem> or set CATALOG_FEED_SIGNING_KEY.');
    process.exit(1);
  }
  const bytes = fs.readFileSync(inPath);
  const signature = signCatalogBytes(bytes, privateKeyPem);
  const outPath = arg('out') ?? `${inPath}.sig`;
  fs.writeFileSync(outPath, signature + '\n');
  console.log(`Signed ${bytes.length} bytes -> ${outPath}`);
}

main();
