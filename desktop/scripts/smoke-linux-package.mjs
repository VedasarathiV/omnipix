// Run with the PACKAGED Electron executable and ELECTRON_RUN_AS_NODE=1,
// against dist-electron/linux-unpacked. Mirrors smoke-mac-package.mjs:
// exercises the packaged backend, native SQLite module and HTTP API without
// opening windows. Also asserts the #1229 chrome-sandbox setuid bit, which
// is what lets the installed app start its GPU process on Linux.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [unpackedDir] = process.argv.slice(2);
assert.ok(unpackedDir, 'usage: smoke-linux-package.mjs <linux-unpacked>');
assert.equal(process.platform, 'linux');
assert.ok(process.versions.electron, 'Must run under the packaged Electron executable');
assert.equal(process.arch, 'x64');

const root = resolve(unpackedDir);
const sandbox = join(root, 'chrome-sandbox');
assert.equal(statSync(sandbox).mode & 0o7777, 0o4755, 'chrome-sandbox must be setuid 4755 (#1229)');

const resources = join(root, 'resources');
const directory = mkdtempSync(join(tmpdir(), 'omnipix-package-smoke-'));
// Never load repository .env settings or start catalog downloads in this test.
process.chdir(directory);
process.env.OMNIPIX_ENV_PATH = join(directory, '.env');
process.env.CATALOG_SYNC_DISABLED = '1';
let server;
let db;
const timeout = setTimeout(() => {
  console.error('Packaged Linux backend smoke test timed out');
  process.exit(1);
}, 60_000);
let exitCode = 1;
try {
  const backend = await import(pathToFileURL(join(resources, 'app.asar/build/server.mjs')).href);
  ({ server } = await backend.startServer({
    dbPath: join(directory, 'smoke.db'),
    clientDist: join(resources, 'client-dist'),
    host: '127.0.0.1',
    preferredPort: 0,
  }));
  db = backend.getDb();
  db.exec('CREATE TABLE package_smoke (value TEXT NOT NULL)');
  db.prepare('INSERT INTO package_smoke VALUES (?)').run('x64');
  assert.equal(db.prepare('SELECT value FROM package_smoke').get().value, 'x64');
  assert.ok(backend.ensureSessionToken());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const dashboard = await fetch(baseUrl, { signal: AbortSignal.timeout(10_000) });
  assert.equal(dashboard.status, 200);
  assert.match(await dashboard.text(), /<html/i);
  const models = await fetch(`${baseUrl}/v1/models`, {
    headers: { Authorization: `Bearer ${backend.getUnifiedApiKey()}` },
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(models.status, 200);
  assert.ok(Array.isArray((await models.json()).data));
  console.log('Packaged x64 Linux backend passed: sandbox bit, SQLite, session, dashboard and /v1/models');
  exitCode = 0;
} catch (error) {
  console.error(error);
} finally {
  clearTimeout(timeout);
  server?.closeAllConnections();
  if (server) await new Promise((done) => server.close(done));
  db?.close();
  process.chdir(tmpdir());
  rmSync(directory, { recursive: true, force: true });
  // The production backend starts recurring maintenance timers.
  process.exit(exitCode);
}
