import { existsSync, readFileSync, watch, type FSWatcher } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { getDb } from '../db/index.js';
import { parseSkillFile, scanSkillFiles, type ParsedSkill } from './skill-files.js';

// File-first skills: SKILL.md files on disk sync into
// the skills table at boot and refresh on change, so dropping a skill file
// into a watched directory installs it with no import step. Precedence,
// low to high: global dir, compat dir (~/.codex/skills, where agent packs
// already live), project .omnipix/skills walking up from cwd, then
// OMNIPIX_SKILLS_DIR. Builtin rows are never touched; dashboard-created
// rows keep working until a same-named file adopts them.

export const SKILLS_SYNC_DEBOUNCE_MS = 500;
const ANCESTOR_CAP = 10;

interface Discovered {
  skill: ParsedSkill;
  path: string;
}

/** Scan roots low→high precedence. Pure of (cwd, home) for tests. */
export function defaultSkillScanDirs(cwd = process.cwd(), home = homedir()): string[] {
  const dirs = [join(home, '.config', 'omnipix', 'skills'), join(home, '.codex', 'skills')];
  const projects: string[] = [];
  let dir = resolve(cwd);
  for (let i = 0; i < ANCESTOR_CAP; i++) {
    projects.unshift(join(dir, '.omnipix', 'skills'));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  dirs.push(...projects);
  const extra = (process.env.OMNIPIX_SKILLS_DIR ?? '').split(delimiter).map(s => s.trim()).filter(Boolean);
  dirs.push(...extra);
  return dirs;
}

/** User-global config home for authored files (overridable in tests). */
export function authoringConfigDir(home = homedir()): string {
  const override = (process.env.OMNIPIX_CONFIG_DIR ?? '').trim();
  if (override) return override;
  return join(home, '.config', 'omnipix');
}

/**
 * Config dirs: the parents of the skill scan dirs. Command and agent
 * markdown lives beside skills (`<config>/{command,commands}/**\/*.md`,
 * `<config>/{agent,agents}/**\/*.md`), opencode layout parity. The
 * authoring home always rides along last (highest precedence) so files
 * the dashboard writes are immediately visible to resolution.
 */
export function defaultConfigDirs(cwd = process.cwd(), home = homedir()): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (dir: string): void => {
    const abs = resolve(dir);
    if (!seen.has(abs)) {
      seen.add(abs);
      out.push(abs);
    }
  };
  for (const dir of defaultSkillScanDirs(cwd, home)) push(dirname(dir));
  push(authoringConfigDir(home));
  return out;
}

export interface SkillsSyncResult {
  added: number;
  updated: number;
  removed: number;
  skipped: number;
}

type SkillRowLite = {
  name: string;
  description: string;
  instructions: string;
  enabled: number;
  builtin: number;
  bundle_json: string | null;
  source_path: string | null;
};

function readRows(db: ReturnType<typeof getDb>): Map<string, SkillRowLite> {
  const rows = db.prepare('SELECT name, description, instructions, enabled, builtin, bundle_json, source_path FROM skills').all() as SkillRowLite[];
  return new Map(rows.map(r => [r.name, r]));
}

/** Bundle members must exist and never be bundles themselves (routes parity). */
function validateBundle(name: string, members: string[], rows: Map<string, SkillRowLite>, discovered: Map<string, Discovered>): string | null {
  for (const member of members) {
    if (member === name) return 'a bundle cannot include itself';
    const found = discovered.get(member);
    if (found) {
      if (found.skill.bundle?.length) return `bundle member cannot itself be a bundle: ${member}`;
      continue;
    }
    const row = rows.get(member);
    if (!row) return `unknown bundle member: ${member}`;
    if (row.bundle_json) return `bundle member cannot itself be a bundle: ${member}`;
  }
  return null;
}

/**
 * Sync SKILL.md files from dirs into the skills table. Last writer wins on
 * name clashes, so pass dirs low→high precedence. Best-effort per file: a
 * malformed skill is skipped, never fatal.
 */
export function syncSkillsFromDirs(dirs: string[]): SkillsSyncResult {
  const result: SkillsSyncResult = { added: 0, updated: 0, removed: 0, skipped: 0 };
  const db = getDb();
  const discovered = new Map<string, Discovered>();
  // Per-dir scans in order: later dirs overwrite earlier ones on name clash,
  // which is what makes the argument order a precedence order.
  for (const dir of dirs) {
    for (const file of scanSkillFiles([dir])) {
      let content: string;
      try {
        content = readFileSync(file, 'utf8');
      } catch {
        result.skipped += 1;
        continue;
      }
      try {
        const skill = parseSkillFile(content);
        discovered.set(skill.name, { skill, path: file });
      } catch {
        result.skipped += 1;
      }
    }
  }
  const rows = readRows(db);
  const builtinNames = new Set([...rows.values()].filter(r => r.builtin).map(r => r.name));
  const insert = db.prepare('INSERT INTO skills (name, description, instructions, enabled, builtin, bundle_json, source_path) VALUES (?, ?, ?, ?, 0, ?, ?)');
  const update = db.prepare('UPDATE skills SET description = ?, instructions = ?, enabled = ?, bundle_json = ?, source_path = ? WHERE name = ?');
  const seen = new Set<string>();
  for (const [name, { skill, path }] of discovered) {
    seen.add(path);
    const existing = rows.get(name);
    if (existing?.builtin) {
      result.skipped += 1;
      continue;
    }
    if (skill.bundle?.length) {
      const err = validateBundle(name, skill.bundle, rows, discovered);
      if (err) {
        result.skipped += 1;
        continue;
      }
    }
    // Import parity: an agency-<name> duplicating a builtin installs disabled.
    let enabled = skill.enabled ? 1 : 0;
    if (skill.name.startsWith('agency-') && skill.enabled && builtinNames.has(skill.name.slice('agency-'.length))) {
      enabled = 0;
    }
    const bundleJson = skill.bundle?.length ? JSON.stringify(skill.bundle) : null;
    if (!existing) {
      insert.run(name, skill.description, skill.instructions, enabled, bundleJson, path);
      result.added += 1;
      continue;
    }
    if (
      existing.description === skill.description &&
      existing.instructions === skill.instructions &&
      existing.enabled === enabled &&
      (existing.bundle_json ?? null) === bundleJson &&
      existing.source_path === path
    ) {
      continue;
    }
    update.run(skill.description, skill.instructions, enabled, bundleJson, path, name);
    result.updated += 1;
  }
  for (const row of rows.values()) {
    if (row.source_path && !seen.has(row.source_path)) {
      db.prepare('DELETE FROM skills WHERE name = ?').run(row.name);
      result.removed += 1;
    }
  }
  return result;
}

let watchers: FSWatcher[] = [];
let debounceTimer: NodeJS.Timeout | null = null;
let watching = false;

function closeAll(): void {
  for (const w of watchers) w.close();
  watchers = [];
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
}

function scheduleResync(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    try {
      syncSkillsFromDirs(defaultSkillScanDirs());
    } catch {
      // A poison resync must not wedge the watcher for healthy edits.
    }
  }, SKILLS_SYNC_DEBOUNCE_MS);
}

/** Boot hook: one sync, then watch every existing scan dir. Idempotent. */
export function startSkillsSync(): void {
  if (watching) return;
  watching = true;
  try {
    syncSkillsFromDirs(defaultSkillScanDirs());
  } catch {
    // Best-effort: a broken skills dir must not take the server down.
  }
  for (const dir of defaultSkillScanDirs()) {
    if (!existsSync(dir)) continue;
    try {
      const watcher = watch(dir, { recursive: true }, () => scheduleResync());
      watcher.on('error', () => { /* a dead watch just stops firing */ });
      watchers.push(watcher);
    } catch {
      // Unwatchable path (permissions, transient): skip it.
    }
  }
}

/** Test hook: stop everything so handles don't leak between tests. */
export function stopSkillsSyncForTests(): void {
  closeAll();
  watching = false;
}

/** Test hook: how many scan dirs currently hold watchers. */
export function watchedSkillsDirsForTests(): number {
  return watchers.length;
}
