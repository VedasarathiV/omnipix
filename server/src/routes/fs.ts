import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { resolveInRoot } from '../lib/workspace.js';

export const fsRouter = Router();

// Host folder browsing for the Files tab: list/read/write real project
// source under an explicit operator-chosen root. Every sub-path goes
// through the workspace jail (no absolute paths, no .. escapes, no
// symlink escapes), and the root itself must be an existing directory.
// This grants nothing the standalone terminal (absolute cwd + exec)
// doesn't already allow.

const MAX_ENTRIES = 3000;
const MAX_DEPTH = 12;
const MAX_READ_BYTES = 200 * 1024;
const MAX_WRITE_BYTES = 1024 * 1024;
const SKIP_DIRS = new Set(['.git', 'node_modules']);

interface FsEntry {
  path: string;
  kind: 'file' | 'dir';
  size?: number;
}

function resolveRoot(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('root must be an absolute directory path');
  const abs = resolve(raw.trim());
  let stat: { isDirectory: () => boolean };
  try {
    stat = statSync(abs);
  } catch {
    throw new Error(`root is not reachable: ${raw.trim().slice(0, 120)}`);
  }
  if (!stat.isDirectory()) throw new Error('root must be a directory');
  return abs;
}

function walk(root: string): { entries: FsEntry[]; truncated: boolean } {
  const entries: FsEntry[] = [];
  let truncated = false;
  const visit = (dir: string, depth: number): void => {
    if (entries.length >= MAX_ENTRIES || depth > MAX_DEPTH) {
      truncated = true;
      return;
    }
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names.sort()) {
      if (entries.length >= MAX_ENTRIES) {
        truncated = true;
        return;
      }
      if (SKIP_DIRS.has(name)) continue;
      const full = join(dir, name);
      let isDir = false;
      let size = 0;
      try {
        const stat = statSync(full);
        isDir = stat.isDirectory();
        size = isDir ? 0 : stat.size;
      } catch {
        continue;
      }
      // Files only: the tree infers directories, and explicit dir entries
      // would shadow them as files (run workspaces list the same way).
      if (!isDir) entries.push({ path: relative(root, full).split(sep).join('/'), kind: 'file', size });
      if (isDir) visit(full, depth + 1);
    }
  };
  visit(root, 0);
  return { entries, truncated };
}

fsRouter.get('/list', (req: Request, res: Response) => {
  let root: string;
  try {
    root = resolveRoot(req.query.root);
  } catch (err) {
    res.status(400).json({ error: { message: err instanceof Error ? err.message : String(err) } });
    return;
  }
  res.json({ root, ...walk(root) });
});

fsRouter.get('/read', (req: Request, res: Response) => {
  let root: string;
  try {
    root = resolveRoot(req.query.root);
  } catch (err) {
    res.status(400).json({ error: { message: err instanceof Error ? err.message : String(err) } });
    return;
  }
  let abs: string;
  try {
    abs = resolveInRoot(root, typeof req.query.path === 'string' ? req.query.path : '');
  } catch (err) {
    res.status(400).json({ error: { message: err instanceof Error ? err.message : String(err) } });
    return;
  }
  let stat;
  try {
    stat = statSync(abs);
  } catch {
    res.status(404).json({ error: { message: 'File not found' } });
    return;
  }
  if (!stat.isFile()) {
    res.status(400).json({ error: { message: 'Not a file' } });
    return;
  }
  let content: string;
  try {
    const buffer = readFileSync(abs);
    if (buffer.includes(0)) {
      res.json({ path: req.query.path, binary: true });
      return;
    }
    const truncated = buffer.length > MAX_READ_BYTES;
    content = buffer.subarray(0, MAX_READ_BYTES).toString('utf8');
    res.json({ path: req.query.path, content, binary: false, truncated });
  } catch (err) {
    res.status(400).json({ error: { message: err instanceof Error ? err.message : String(err) } });
  }
});

const writeSchema = z.object({
  root: z.string().min(1).max(2000),
  path: z.string().min(1).max(2000),
  content: z.string().max(MAX_WRITE_BYTES + 100000),
});

fsRouter.put('/write', (req: Request, res: Response) => {
  const parsed = writeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.issues.map(e => e.message).join(', ') } });
    return;
  }
  if (Buffer.byteLength(parsed.data.content, 'utf8') > MAX_WRITE_BYTES) {
    res.status(400).json({ error: { message: 'Content exceeds the 1MB write cap' } });
    return;
  }
  let root: string;
  try {
    root = resolveRoot(parsed.data.root);
  } catch (err) {
    res.status(400).json({ error: { message: err instanceof Error ? err.message : String(err) } });
    return;
  }
  let abs: string;
  try {
    abs = resolveInRoot(root, parsed.data.path);
  } catch (err) {
    res.status(400).json({ error: { message: err instanceof Error ? err.message : String(err) } });
    return;
  }
  try {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, parsed.data.content, 'utf8');
  } catch (err) {
    res.status(400).json({ error: { message: err instanceof Error ? err.message : String(err) } });
    return;
  }
  res.json({ ok: true, path: parsed.data.path });
});
