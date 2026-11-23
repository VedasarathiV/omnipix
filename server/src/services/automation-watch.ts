import { watch, type FSWatcher } from 'node:fs';
import { existsSync } from 'node:fs';
import { notify } from '../lib/notifications.js';
import { getAutomation, listAutomations, parseWatchJson, runAutomationOnce } from './automations.js';

// File-watch triggers for automations: a change under a watched path fires the
// automation's agent run, under the same gates as cron schedules (enabled +
// reviewed, never stack on a live run). Pure local-first: no webhooks, no
// public URL, works with the laptop lid half-closed.

export const WATCH_DEBOUNCE_MS = 2000;

let watchers = new Map<number, FSWatcher[]>();
let debounceTimers = new Map<number, NodeJS.Timeout>();
let watching = false;

function closeAll(): void {
  for (const list of watchers.values()) for (const w of list) w.close();
  watchers = new Map();
  for (const t of debounceTimers.values()) clearTimeout(t);
  debounceTimers = new Map();
}

function fireAutomation(id: number, changedPath: string): void {
  const automation = getAutomation(id);
  if (!automation) return;
  if (!automation.enabled || !automation.reviewed) return;
  try {
    const runId = runAutomationOnce(id);
    notify(
      'automation-watch',
      `Automation '${automation.name}' fired on file change`,
      `${changedPath} → run #${runId}`,
      `/agents?tab=runs&run=${runId}`,
    );
  } catch {
    // Live run already going (or disabled mid-flight): skip, never stack.
  }
}

function scheduleFire(id: number, changedPath: string): void {
  const existing = debounceTimers.get(id);
  if (existing) clearTimeout(existing);
  debounceTimers.set(id, setTimeout(() => {
    debounceTimers.delete(id);
    try {
      fireAutomation(id, changedPath);
    } catch {
      // A poison watch must not wedge the watcher for the healthy ones.
    }
  }, WATCH_DEBOUNCE_MS));
}

/** (Re)build every watcher from the DB. Idempotent; safe to call after CRUD. */
export function refreshAutomationWatchers(): void {
  closeAll();
  for (const automation of listAutomations()) {
    const paths = parseWatchJson(automation.watch_json);
    if (!paths.length) continue;
    const list: FSWatcher[] = [];
    for (const path of paths) {
      if (!existsSync(path)) continue;
      try {
        const watcher = watch(path, { recursive: true }, (_event, filename) => {
          scheduleFire(automation.id, filename ? `${path}/${filename}` : path);
        });
        watcher.on('error', () => { /* a dead watch just stops firing */ });
        list.push(watcher);
      } catch {
        // Unwatchable path (permissions, transient): skip it.
      }
    }
    if (list.length) watchers.set(automation.id, list);
  }
}

/** Start file watching on boot. Idempotent. */
export function startAutomationWatchers(): void {
  if (watching) return;
  watching = true;
  try {
    refreshAutomationWatchers();
  } catch {
    // Watching is best-effort: a failure here must not take the server down.
  }
}

/** Test hook: stop everything so handles don't leak between tests. */
export function stopAutomationWatchersForTests(): void {
  closeAll();
  watching = false;
}

/** Test hook: how many automations currently hold watchers. */
export function watchedAutomationCountForTests(): number {
  return watchers.size;
}
