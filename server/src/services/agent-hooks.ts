import { getDb } from '../db/index.js';
import { agentToolByName } from './agent-tools.js';
import { assertCommandAllowed, execShell, runWorkspace } from '../lib/workspace.js';
import type { AgentStep } from './agent-runtime.js';

// Deterministic lifecycle hooks (gap 5): operator-configured shell commands
// that gate or observe tool execution. Programmable policy to complement
// human approvals — e.g. "no shell command touching prod", "lint after
// every edit", "block commits without a ticket id".
//
// Events:
//   pre_tool  — runs BEFORE approval parking. First nonzero exit denies the
//               call (sparing the human), and a `hook` step records the veto.
//   post_tool — runs AFTER the call settles. Failures record a `hook` step
//               but never change the result; successes are silent.
//
// Hooks run with cwd = the run's workspace and OMNIPIX_HOOK_* env vars. The
// shell denylist applies: hooks automate policy, they don't bypass it.

export const HOOK_EVENTS = ['pre_tool', 'post_tool'] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];

export const HOOK_MIN_TIMEOUT_MS = 1000;
export const HOOK_MAX_TIMEOUT_MS = 300_000;
export const HOOK_DEFAULT_TIMEOUT_MS = 30_000;

export interface HookRow {
  id: number;
  name: string;
  event: HookEvent;
  tool_filter: string;
  command: string;
  timeout_ms: number;
  enabled: number;
  created_at: string;
}

export interface HookInput {
  name: string;
  event: HookEvent;
  toolFilter?: string;
  command: string;
  timeoutMs?: number;
  enabled?: boolean;
}

type StepRecorder = (
  kind: AgentStep['kind'],
  name: string | null,
  content: Record<string, unknown>,
) => void;

function validate(input: Partial<HookInput>, partial: boolean): void {
  if (!partial || input.name !== undefined) {
    if (!input.name?.trim() || input.name.trim().length > 128) {
      throw new Error('name must be 1..128 characters');
    }
  }
  if (!partial || input.event !== undefined) {
    if (input.event !== 'pre_tool' && input.event !== 'post_tool') {
      throw new Error("event must be 'pre_tool' or 'post_tool'");
    }
  }
  if (input.toolFilter !== undefined && input.toolFilter !== '') {
    if (input.toolFilter.length > 128 || !agentToolByName(input.toolFilter)) {
      throw new Error(`Unknown tool filter: ${input.toolFilter}.`);
    }
  }
  if (!partial || input.command !== undefined) {
    if (!input.command?.trim() || input.command.trim().length > 2000) {
      throw new Error('command must be 1..2000 characters');
    }
    assertCommandAllowed(input.command);
  }
  if (input.timeoutMs !== undefined) {
    if (!Number.isInteger(input.timeoutMs) || input.timeoutMs < HOOK_MIN_TIMEOUT_MS || input.timeoutMs > HOOK_MAX_TIMEOUT_MS) {
      throw new Error(`timeoutMs must be ${HOOK_MIN_TIMEOUT_MS}..${HOOK_MAX_TIMEOUT_MS}`);
    }
  }
}

export function listHooks(): HookRow[] {
  return getDb().prepare('SELECT * FROM agent_hooks ORDER BY id').all() as HookRow[];
}

export function getHook(id: number): HookRow | null {
  const row = getDb().prepare('SELECT * FROM agent_hooks WHERE id = ?').get(id) as HookRow | undefined;
  return row ?? null;
}

export function createHook(input: HookInput): HookRow {
  validate(input, false);
  const row = getDb().prepare(
    `INSERT INTO agent_hooks (name, event, tool_filter, command, timeout_ms, enabled)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
  ).get(
    input.name.trim(), input.event, input.toolFilter ?? '',
    input.command.trim(), input.timeoutMs ?? HOOK_DEFAULT_TIMEOUT_MS,
    input.enabled === false ? 0 : 1,
  ) as HookRow;
  return row;
}

export function updateHook(id: number, patch: Partial<HookInput>): HookRow {
  validate(patch, true);
  const current = getHook(id);
  if (!current) throw new Error('Hook not found');
  const next = {
    name: patch.name?.trim() ?? current.name,
    event: patch.event ?? current.event,
    tool_filter: patch.toolFilter ?? current.tool_filter,
    command: patch.command?.trim() ?? current.command,
    timeout_ms: patch.timeoutMs ?? current.timeout_ms,
    enabled: patch.enabled === undefined ? current.enabled : (patch.enabled ? 1 : 0),
  };
  getDb().prepare(
    'UPDATE agent_hooks SET name = ?, event = ?, tool_filter = ?, command = ?, timeout_ms = ?, enabled = ? WHERE id = ?',
  ).run(next.name, next.event, next.tool_filter, next.command, next.timeout_ms, next.enabled, id);
  return getHook(id)!;
}

export function deleteHook(id: number): void {
  const info = getDb().prepare('DELETE FROM agent_hooks WHERE id = ?').run(id);
  if (info.changes === 0) throw new Error('Hook not found');
}

function matchingHooks(event: HookEvent, tool: string): HookRow[] {
  return (getDb().prepare(
    'SELECT * FROM agent_hooks WHERE event = ? AND enabled = 1 ORDER BY id',
  ).all(event) as HookRow[]).filter(h => h.tool_filter === '' || h.tool_filter === tool);
}

function payloadEnv(event: HookEvent, runId: number, tool: string, extra: Record<string, unknown>): Record<string, string> {
  return {
    OMNIPIX_HOOK_EVENT: event,
    OMNIPIX_HOOK_TOOL: tool,
    OMNIPIX_HOOK_RUN_ID: String(runId),
    OMNIPIX_HOOK_PAYLOAD: JSON.stringify({ event, runId, tool, ...extra }).slice(0, 8192),
  };
}

/**
 * Run pre_tool hooks. First veto wins: the call is denied and a `hook` step
 * records which hook vetoed and why. Never throws — an infrastructure
 * failure fails CLOSED (deny) so a broken gate can't silently open.
 */
export async function runPreToolHooks(
  runId: number,
  tool: string,
  args: Record<string, unknown>,
  record: StepRecorder,
  signal?: AbortSignal,
): Promise<{ allowed: boolean; reason?: string }> {
  const failClosed = (message: string): { allowed: boolean; reason?: string } => {
    record('hook', 'hook', { event: 'pre_tool', tool, allowed: false, message });
    return { allowed: false, reason: message };
  };
  let hooks: HookRow[];
  try {
    hooks = matchingHooks('pre_tool', tool);
  } catch (err) {
    return failClosed(`hook lookup failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  for (const hook of hooks) {
    if (signal?.aborted) return { allowed: true };
    try {
      assertCommandAllowed(hook.command);
    } catch {
      record('hook', 'hook', { event: 'pre_tool', hook: hook.name, tool, allowed: false, message: `hook "${hook.name}" blocked by the command denylist` });
      return { allowed: false, reason: `denied by hook "${hook.name}": command blocked by policy` };
    }
    let result;
    try {
      result = await execShell(hook.command, {
        cwd: runWorkspace(runId),
        timeoutMs: hook.timeout_ms,
        envExtra: payloadEnv('pre_tool', runId, tool, { args }),
      });
    } catch (err) {
      return failClosed(`hook "${hook.name}" crashed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (result.timedOut) {
      const message = `denied by hook "${hook.name}": timed out after ${hook.timeout_ms}ms`;
      record('hook', 'hook', { event: 'pre_tool', hook: hook.name, tool, allowed: false, message });
      return { allowed: false, reason: message };
    }
    if (result.exitCode !== 0) {
      const detail = (result.stderr.trim() || result.stdout.trim()).slice(0, 500) || `exit ${result.exitCode}`;
      const message = `denied by hook "${hook.name}": ${detail}`;
      record('hook', 'hook', { event: 'pre_tool', hook: hook.name, tool, allowed: false, message });
      return { allowed: false, reason: message };
    }
  }
  return { allowed: true };
}

/**
 * Run post_tool hooks. Failures record a `hook` step but never change the
 * settled result; successes are silent. Never throws.
 */
export async function runPostToolHooks(
  runId: number,
  tool: string,
  args: Record<string, unknown>,
  outcome: { ok: boolean; result: string },
  record: StepRecorder,
  signal?: AbortSignal,
): Promise<void> {
  let hooks: HookRow[];
  try {
    hooks = matchingHooks('post_tool', tool);
  } catch {
    return;
  }
  for (const hook of hooks) {
    if (signal?.aborted) return;
    try {
      assertCommandAllowed(hook.command);
      const result = await execShell(hook.command, {
        cwd: runWorkspace(runId),
        timeoutMs: hook.timeout_ms,
        envExtra: payloadEnv('post_tool', runId, tool, { args, ok: outcome.ok, result: outcome.result.slice(0, 4000) }),
      });
      if (result.timedOut || result.exitCode !== 0) {
        const detail = result.timedOut
          ? `timed out after ${hook.timeout_ms}ms`
          : ((result.stderr.trim() || result.stdout.trim()).slice(0, 500) || `exit ${result.exitCode}`);
        record('hook', 'hook', {
          event: 'post_tool', hook: hook.name, tool, allowed: true,
          message: `hook "${hook.name}" failed: ${detail}`,
        });
      }
    } catch (err) {
      record('hook', 'hook', {
        event: 'post_tool', hook: hook.name, tool, allowed: true,
        message: `hook "${hook.name}" crashed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
}
