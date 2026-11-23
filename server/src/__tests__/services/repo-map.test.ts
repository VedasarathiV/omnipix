import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  REPO_MAP_MAX_CHARS,
  REPO_MAP_MAX_FILES,
  buildRepoMap,
  extractSymbols,
} from '../../services/repo-map.js';

describe('extractSymbols', () => {
  it('reads TypeScript classes, functions, arrows, and types', () => {
    const symbols = extractSymbols('a.ts', [
      'export class Server {',
      'async function start(port: number) {',
      'export const run = async (x: string) => {',
      'const once = v => v;',
      'function hidden() {',
      'export interface Opts {',
      'export type Name = string;',
      '  constructor() {',
      '  const x = 1;',
    ].join('\n'));
    expect(symbols).toEqual([
      'class Server',
      'function start',
      'function run',
      'function once',
      'function hidden',
      'type Opts',
      'type Name',
    ]);
  });

  it('reads Python classes, functions, and methods', () => {
    const symbols = extractSymbols('b.py', 'class Store:\n  def get(self):\n    pass\n\ndef top():\n  pass\n');
    expect(symbols).toEqual(['class Store', 'function get', 'function top']);
  });

  it('reads Go, Rust, and shell idioms', () => {
    expect(extractSymbols('c.go', 'func (s *S) Run() {\nfunc Main() {\ntype Config struct {\n')).toEqual([
      'function Run', 'function Main', 'type Config',
    ]);
    expect(extractSymbols('d.rs', 'pub fn main() {\nstruct Point {\nimpl Point {\n')).toEqual([
      'function main', 'type Point', 'impl Point',
    ]);
    expect(extractSymbols('e.sh', 'deploy() {\n  echo hi\n}\n')).toEqual(['function deploy']);
  });

  it('returns nothing for unknown extensions and minified blobs', () => {
    expect(extractSymbols('notes.md', '# hi')).toEqual([]);
    expect(extractSymbols('bundle.js', `var a=${'x'.repeat(2000)};`)).toEqual([]);
  });

  it('dedupes repeat declarations', () => {
    expect(extractSymbols('f.ts', 'function a() {\nfunction a() {\n')).toEqual(['function a']);
  });
});

describe('buildRepoMap', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnipix-repomap-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function write(rel: string, content: string | Buffer): void {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }

  it('sketches every mappable file with its symbols', () => {
    write('src/app.ts', 'export class App {\n}\n');
    write('lib/util.py', 'def helper():\n  pass\n');
    const map = buildRepoMap(dir);
    expect(map.files).toBe(2);
    expect(map.symbols).toBe(2);
    expect(map.truncated).toBe(false);
    expect(map.text).toContain('src/app.ts:\n  class App');
    expect(map.text).toContain('lib/util.py:\n  function helper');
  });

  it('skips dependency dirs, binaries, oversized files, and symbol-less files', () => {
    write('node_modules/dep/index.js', 'function dep() {}');
    write('logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
    write('big.ts', `const s = '${'y'.repeat(120 * 1024)}';`);
    write('README.md', '# docs');
    write('ok.ts', 'function fine() {}');
    const map = buildRepoMap(dir);
    expect(map.files).toBe(1);
    expect(map.text).toContain('ok.ts');
    expect(map.text).not.toContain('node_modules');
  });

  it('maps a subdir with prefixed paths', () => {
    write('a/one.ts', 'function one() {}');
    write('b/two.ts', 'function two() {}');
    const map = buildRepoMap(path.join(dir, 'b'), 'b');
    expect(map.files).toBe(1);
    expect(map.text).toContain('b/two.ts:');
  });

  it('caps files and chars with a truncation marker', () => {
    for (let i = 0; i < REPO_MAP_MAX_FILES + 20; i++) {
      write(`f${String(i).padStart(3, '0')}.ts`, `function f${i}() {}`);
    }
    const map = buildRepoMap(dir);
    expect(map.files).toBe(REPO_MAP_MAX_FILES);
    expect(map.truncated).toBe(true);
    expect(map.text.length).toBeLessThanOrEqual(REPO_MAP_MAX_CHARS + 500);
    expect(map.text).toContain('truncated');
  });

  it('returns an empty map for an empty or missing dir', () => {
    expect(buildRepoMap(dir).text).toBe('');
    expect(buildRepoMap(path.join(dir, 'nope')).text).toBe('');
  });
});
