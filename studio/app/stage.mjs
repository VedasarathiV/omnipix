#!/usr/bin/env node
// Stage the studio web bundle into the Electron project so electron-builder
// picks it up (it only packages files under the project root).
import { cpSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '../dist');
const dest = path.resolve(here, 'dist-ui');

if (!existsSync(path.join(src, 'index.html'))) {
  console.error('studio/dist/index.html missing — run `npm run build` in studio/ first.');
  process.exit(1);
}
rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.log(`staged ${src} -> ${dest}`);
