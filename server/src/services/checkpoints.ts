import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../db/index.js';
import { runWorkspace, workspaceRoot } from '../lib/workspace.js';

// Run checkpoints (gap 2): point-in-time workspace snapshots with rewind.
//
// Snapshots live OUTSIDE workspaces (root/.checkpoints/<run>/<id>) so they
// never pollute grep results or nest inside each other. The loop snapshots
// automatically before every file mutation; operators can also snapshot and
// restore manually. Restore rewinds FILES only — the step trace keeps a
// restore record, so history stays honest.

export const CHECKPOINT_KEEP = 20;
export const CHECKPOINT_MAX_BYTES = 50 * 1024 * 1024;

export interface CheckpointRow {
  id: number;
  run_id: number;
  seq: number;
  label: string;
  rel_path: string;
  created_at: string;
}

function dirSize(root: string, cap: number): number {
  let total = 0;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        try {
          total += fs.statSync(full).size;
        } catch {
          // Vanished mid-walk — ignore.
        }
        if (total > cap) return total;
      }
    }
  }
  return total;
}

export function createCheckpoint(runId: number, label = '', seq = 0): number {
  const db = getDb();
  const run = db.prepare('SELECT id FROM agent_runs WHERE id = ?').get(runId);
  if (!run) throw new Error('Run not found');
  const src = runWorkspace(runId);
  if (!fs.existsSync(src)) fs.mkdirSync(src, { recursive: true });
  if (dirSize(src, CHECKPOINT_MAX_BYTES) > CHECKPOINT_MAX_BYTES) {
    throw new Error('workspace too large to snapshot (>50MB)');
  }
  const row = db.prepare(
    'INSERT INTO checkpoints (run_id, seq, label, rel_path) VALUES (?, ?, ?, ?) RETURNING id',
  ).get(runId, seq, label.slice(0, 200), '') as { id: number };
  const relPath = path.join('.checkpoints', `run-${runId}`, String(row.id));
  const dest = path.join(workspaceRoot(), relPath);
  try {
    fs.mkdirSync(dest, { recursive: true });
    fs.cpSync(src, dest, { recursive: true, dereference: false });
  } catch (err) {
    db.prepare('DELETE FROM checkpoints WHERE id = ?').run(row.id);
    throw new Error(`snapshot failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  db.prepare('UPDATE checkpoints SET rel_path = ? WHERE id = ?').run(relPath, row.id);
  pruneCheckpoints(runId);
  return row.id;
}

function pruneCheckpoints(runId: number): void {
  const db = getDb();
  const stale = db.prepare('SELECT id, rel_path FROM checkpoints WHERE run_id = ? ORDER BY id DESC LIMIT -1 OFFSET ?')
    .all(runId, CHECKPOINT_KEEP) as { id: number; rel_path: string }[];
  for (const row of stale) {
    try {
      fs.rmSync(path.join(workspaceRoot(), row.rel_path), { recursive: true, force: true });
    } catch {
      // Already gone — drop the row anyway.
    }
    db.prepare('DELETE FROM checkpoints WHERE id = ?').run(row.id);
  }
}

export function getCheckpoint(id: number): CheckpointRow | null {
  const row = getDb().prepare('SELECT * FROM checkpoints WHERE id = ?').get(id) as CheckpointRow | undefined;
  return row ?? null;
}

export function listCheckpoints(runId: number): CheckpointRow[] {
  return getDb().prepare('SELECT * FROM checkpoints WHERE run_id = ? ORDER BY id DESC').all(runId) as CheckpointRow[];
}

/**
 * Restore a snapshot over the run's workspace: wipe current contents, copy
 * the snapshot back. Returns the run id. Never touches the step trace —
 * the caller records a restore step.
 */
export function restoreCheckpoint(id: number): number {
  const row = getCheckpoint(id);
  if (!row) throw new Error('Checkpoint not found');
  const src = path.join(workspaceRoot(), row.rel_path);
  if (!fs.existsSync(src)) throw new Error('Checkpoint files are gone from disk');
  const dest = runWorkspace(row.run_id);
  for (const entry of fs.readdirSync(dest)) {
    fs.rmSync(path.join(dest, entry), { recursive: true, force: true });
  }
  fs.cpSync(src, dest, { recursive: true, dereference: false });
  return row.run_id;
}

/** Best-effort auto-snapshot before a file mutation. Never throws. */
export function maybeCheckpoint(runId: number, tool: string, args: Record<string, unknown>, seq: number): void {
  if (tool !== 'write_file' && tool !== 'edit_file') return;
  try {
    const file = typeof args.path === 'string' ? args.path : '';
    createCheckpoint(runId, file ? `before ${tool} ${file}` : `before ${tool}`, seq);
  } catch {
    // Snapshots are safety, not correctness: a full disk or huge workspace
    // must never block the write itself.
  }
}
