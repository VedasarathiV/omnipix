import { getDb } from '../db/index.js';
import type { Scheduler } from '../lib/scheduler.js';
import { notify } from '../lib/notifications.js';
import { createAgentRun, executeAgentRun, getAgentRun } from './agent-runtime.js';
import { createSession } from './agent-sessions.js';
import { emitWebhook } from './webhooks.js';

// Scheduled automations (Phase 4): recurring agent goals on a cron schedule.
//
// Safety rails (VSCode-automations style):
// - A schedule never fires until a MANUAL run completed first (reviewed=1).
//   Review means the operator ran it once and saw it behave.
// - One run at a time per automation: a still-running previous execution
//   skips the tick instead of stacking.
// - Every completion (manual or scheduled) writes a notification; failures
//   name the run so the trace is one click away.

export interface AutomationRow {
  id: number;
  name: string;
  goal: string;
  schedule: string;
  model: string;
  enabled: number;
  reviewed: number;
  last_run_id: number | null;
  last_status: string | null;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
}

// ── Cron ─────────────────────────────────────────────────────────────────────
// Five-field cron (minute hour dom month dow), local time. Supports *, lists,
// ranges, and steps. Deliberately small: no names, no specials, no seconds.

const FIELD_RANGES = [
  [0, 59], [0, 23], [1, 31], [1, 12], [0, 6],
] as const;

function parseField(text: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>();
  for (const part of text.split(',')) {
    const [range, stepText] = part.split('/');
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) return null;
    let from = min;
    let to = max;
    if (range !== '*') {
      const dash = range.indexOf('-');
      if (dash >= 0) {
        from = Number(range.slice(0, dash));
        to = Number(range.slice(dash + 1));
      } else {
        from = Number(range);
        to = from;
      }
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < min || to > max || from > to) return null;
    }
    for (let value = from; value <= to; value += step) out.add(value);
  }
  return out.size ? out : null;
}

export function parseCron(schedule: string): Array<Set<number>> | null {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const parsed = fields.map((field, i) => parseField(field, FIELD_RANGES[i][0], FIELD_RANGES[i][1]));
  if (parsed.some(p => !p)) return null;
  return parsed as Array<Set<number>>;
}

/** Next fire strictly after `from` (minute precision, ~1y horizon). */
export function nextCronFire(schedule: string, from: Date = new Date()): Date | null {
  const fields = parseCron(schedule);
  if (!fields) return null;
  // dom/dow follow cron's OR rule: * in either side means the other decides.
  const domStar = fields[2].size === 31;
  const dowStar = fields[4].size === 7;
  const candidate = new Date(from.getTime() + 60_000);
  candidate.setSeconds(0, 0);
  for (let i = 0; i < 525_600; i++) {
    const minuteMatch = fields[0].has(candidate.getMinutes());
    const hourMatch = fields[1].has(candidate.getHours());
    const domMatch = fields[2].has(candidate.getDate());
    const monthMatch = fields[3].has(candidate.getMonth() + 1);
    // JS Sunday=0 matches cron Sunday=0; cron 7 (also Sunday) folds to 0.
    const dowMatch = fields[4].has(candidate.getDay()) || (fields[4].has(7) && candidate.getDay() === 0);
    const dayMatch = domStar && dowStar ? true : domStar ? dowMatch : dowStar ? domMatch : (domMatch || dowMatch);
    if (minuteMatch && hourMatch && monthMatch && dayMatch) return candidate;
    candidate.setTime(candidate.getTime() + 60_000);
  }
  return null;
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export interface AutomationInput {
  name: string;
  goal: string;
  schedule?: string;
  model?: string;
  enabled?: boolean;
}

export function createAutomation(input: AutomationInput): number {
  const name = input.name.trim();
  if (!/^[a-z0-9][a-z0-9-_]*$/i.test(name)) {
    throw new Error('Invalid automation name: letters, digits, dashes, underscores.');
  }
  const schedule = (input.schedule ?? '').trim();
  if (schedule && !parseCron(schedule)) throw new Error(`Invalid cron schedule: ${schedule}`);
  try {
    const row = getDb().prepare(
      `INSERT INTO automations (name, goal, schedule, model, enabled, next_run_at)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    ).get(
      name, input.goal.trim(), schedule, input.model?.trim() || 'auto',
      input.enabled === false ? 0 : 1,
      schedule ? (nextCronFire(schedule)?.toISOString() ?? null) : null,
    ) as { id: number };
    return row.id;
  } catch (err) {
    if (err instanceof Error && /UNIQUE/i.test(err.message)) throw new Error(`Automation '${name}' already exists.`);
    throw err;
  }
}

export function getAutomation(id: number): AutomationRow | null {
  const row = getDb().prepare('SELECT * FROM automations WHERE id = ?').get(id) as AutomationRow | undefined;
  return row ?? null;
}

export function listAutomations(): AutomationRow[] {
  return getDb().prepare('SELECT * FROM automations ORDER BY name').all() as AutomationRow[];
}

export function updateAutomation(id: number, input: Partial<AutomationInput>): void {
  const existing = getAutomation(id);
  if (!existing) throw new Error('Automation not found');
  const name = input.name?.trim() ?? existing.name;
  if (!/^[a-z0-9][a-z0-9-_]*$/i.test(name)) throw new Error('Invalid automation name.');
  const schedule = (input.schedule ?? existing.schedule).trim();
  if (schedule && !parseCron(schedule)) throw new Error(`Invalid cron schedule: ${schedule}`);
  getDb().prepare(
    `UPDATE automations SET name = ?, goal = ?, schedule = ?, model = ?, enabled = ?,
       next_run_at = ? WHERE id = ?`,
  ).run(
    name, (input.goal ?? existing.goal).trim(), schedule, (input.model ?? existing.model).trim() || 'auto',
    input.enabled === undefined ? existing.enabled : (input.enabled ? 1 : 0),
    schedule ? (nextCronFire(schedule)?.toISOString() ?? null) : null, id,
  );
}

export function deleteAutomation(id: number): boolean {
  return getDb().prepare('DELETE FROM automations WHERE id = ?').run(id).changes > 0;
}

// ── Execution ────────────────────────────────────────────────────────────────

function launchRun(automation: AutomationRow): number {
  const db = getDb();
  const sessionId = createSession(`Automation: ${automation.name}`);
  const runId = createAgentRun({
    goal: automation.goal, model: automation.model, maxSteps: 12, sessionId,
  });
  db.prepare('UPDATE automations SET last_run_id = ?, last_status = \'running\', last_run_at = ? WHERE id = ?')
    .run(runId, new Date().toISOString(), automation.id);
  void executeAgentRun(runId, { goal: automation.goal, model: automation.model, maxSteps: 12 }).catch(() => {
    // The run records its own failure; the tick below observes it.
  });
  return runId;
}

/**
 * Manual run: fires immediately regardless of schedule/review, and marks
 * the automation reviewed once that run lands terminal. Review is what
 * unlocks the recurring schedule.
 */
export function runAutomationOnce(id: number): number {
  const automation = getAutomation(id);
  if (!automation) throw new Error('Automation not found');
  if (!automation.enabled) throw new Error(`Automation '${automation.name}' is disabled.`);
  if (automation.last_run_id != null) {
    const live = getAgentRun(automation.last_run_id);
    if (live && (live.status === 'running' || live.status === 'awaiting_approval')) {
      throw new Error(`Automation '${automation.name}' already has a live run (#${live.id}).`);
    }
  }
  return launchRun(automation);
}

/** Observe one automation: review manual runs, fire due schedules. */
export function tickAutomation(automation: AutomationRow, now = new Date()): void {
  const db = getDb();
  // 1. Observe the last run.
  if (automation.last_run_id != null) {
    const run = getAgentRun(automation.last_run_id);
    if (run && run.status !== 'running' && run.status !== 'awaiting_approval') {
      if (automation.last_status === 'running') {
        db.prepare('UPDATE automations SET last_status = ? WHERE id = ?').run(run.status, automation.id);
        if (!automation.reviewed) {
          db.prepare('UPDATE automations SET reviewed = 1 WHERE id = ?').run(automation.id);
        }
        notify(
          run.status === 'done' ? 'automation-done' : 'automation-failed',
          `Automation '${automation.name}' ${run.status}`,
          (run.final_answer ?? run.error ?? '').slice(0, 500),
          `/agents?tab=runs&run=${run.id}`,
        );
        emitWebhook('automation.finished', {
          automationId: automation.id,
          name: automation.name,
          status: run.status,
          runId: run.id,
        });
        automation = getAutomation(automation.id)!;
      }
    } else if (run) {
      return; // live run: never stack, never fire
    }
  }
  // 2. Fire a due schedule (reviewed + enabled only).
  if (!automation.enabled || !automation.reviewed || !automation.schedule) return;
  const next = automation.next_run_at ? new Date(automation.next_run_at) : null;
  if (next && next.getTime() <= now.getTime()) {
    launchRun(automation);
    const following = nextCronFire(automation.schedule, now);
    db.prepare('UPDATE automations SET next_run_at = ? WHERE id = ?').run(following?.toISOString() ?? null, automation.id);
  } else if (!next) {
    const following = nextCronFire(automation.schedule, now);
    db.prepare('UPDATE automations SET next_run_at = ? WHERE id = ?').run(following?.toISOString() ?? null, automation.id);
  }
}

export function tickAllAutomations(now = new Date()): void {
  for (const automation of listAutomations()) {
    try {
      tickAutomation(automation, now);
    } catch {
      // One bad automation (deleted mid-tick, poison schedule) must not
      // wedge the scheduler for the healthy ones.
    }
  }
}

let schedulerRunning = false;

/** Start the 60s automation tick on both boot paths. Idempotent. */
export function startAutomationScheduler(scheduler: Scheduler): void {
  if (schedulerRunning) return;
  schedulerRunning = true;
  const scheduleNext = (): void => {
    scheduler.after(60_000, async () => {
      try {
        tickAllAutomations();
      } finally {
        scheduleNext();
      }
    });
  };
  scheduleNext();
}
