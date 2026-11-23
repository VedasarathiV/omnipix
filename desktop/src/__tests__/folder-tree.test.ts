import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFolderTree } from '../folder-tree.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnipix-folder-'));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'index.ts'), 'x');
  fs.writeFileSync(path.join(dir, 'README.md'), 'x');
  fs.mkdirSync(path.join(dir, 'node_modules', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', 'lib', 'i.js'), 'x');
  fs.writeFileSync(path.join(dir, '.hidden'), 'x');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('readFolderTree', () => {
  it('lists files and dirs as a text tree', () => {
    const r = readFolderTree(dir);
    expect(r.root).toBe(dir);
    expect(r.tree).toContain('src/');
    expect(r.tree).toContain('index.ts');
    expect(r.tree).toContain('README.md');
    expect(r.files).toBe(2);
    expect(r.truncated).toBe(false);
  });

  it('skips dependency dirs and hidden files', () => {
    const r = readFolderTree(dir);
    expect(r.tree).not.toContain('node_modules');
    expect(r.tree).not.toContain('.hidden');
  });

  it('truncates past the file cap', () => {
    for (let i = 0; i < 250; i++) fs.writeFileSync(path.join(dir, `f${i}.txt`), 'x');
    const r = readFolderTree(dir);
    expect(r.truncated).toBe(true);
    expect(r.files).toBeLessThanOrEqual(200);
    expect(r.tree).toContain('truncated');
  });

  it('throws for missing paths and files', () => {
    expect(() => readFolderTree(path.join(dir, 'nope'))).toThrow('Cannot open folder');
    expect(() => readFolderTree(path.join(dir, 'README.md'))).toThrow('Not a folder');
  });
});
