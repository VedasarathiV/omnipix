import fs from 'node:fs';
import path from 'node:path';

// Read a folder into a capped text tree for chat context ("open this folder
// in the Playground"). Pure filesystem walk, no Electron imports, so the
// dashboard's folder button and the unit tests share it through the
// `omnipix:read-folder` IPC in main.ts.

const MAX_DEPTH = 3;
const MAX_FILES = 200;
const MAX_NAME = 80;

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', '__pycache__', '.venv', 'venv',
  'dist', 'build', 'out', 'target', '.next', '.nuxt', 'coverage',
  '.idea', '.vscode', '.DS_Store', 'Pods', '.gradle', '.tox', '.mypy_cache',
]);

export interface FolderTree {
  root: string;
  tree: string;
  files: number;
  truncated: boolean;
}

function safeName(name: string): string {
  const clean = name.replace(/[\r\n\t]/g, ' ').trim();
  return clean.length > MAX_NAME ? clean.slice(0, MAX_NAME - 1) + '…' : clean;
}

export function readFolderTree(root: string): FolderTree {
  const abs = path.resolve(root);
  const lines: string[] = [path.basename(abs) + '/'];
  let files = 0;
  let truncated = false;

  const walk = (dir: string, depth: number, prefix: string): void => {
    if (files >= MAX_FILES) { truncated = true; return; }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      lines.push(`${prefix}‹unreadable›`);
      return;
    }
    const visible = entries
      .filter(e => !e.name.startsWith('.') || e.name === '.env')
      .filter(e => !(e.isDirectory() && SKIP_DIRS.has(e.name)))
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    visible.forEach((entry, i) => {
      if (files >= MAX_FILES) { truncated = true; return; }
      const last = i === visible.length - 1;
      const branch = last ? '└── ' : '├── ';
      const name = safeName(entry.name);
      if (entry.isDirectory()) {
        lines.push(`${prefix}${branch}${name}/`);
        if (depth < MAX_DEPTH) walk(path.join(dir, entry.name), depth + 1, prefix + (last ? '    ' : '│   '));
        else lines.push(`${prefix}${last ? '    ' : '│   '}‹…›`);
      } else if (entry.isFile()) {
        files += 1;
        lines.push(`${prefix}${branch}${name}`);
      }
    });
  };

  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    throw new Error(`Cannot open folder: ${abs}`);
  }
  if (!stat.isDirectory()) throw new Error(`Not a folder: ${abs}`);
  walk(abs, 1, '');
  if (truncated) lines.push(`‹truncated to ${MAX_FILES} files›`);
  return { root: abs, tree: lines.join('\n'), files, truncated };
}
