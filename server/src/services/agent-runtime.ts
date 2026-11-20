import { getDb } from '../db/index.js';
import { runModelCall } from './fusion.js';
import { pinnedModelFitsRequestSize, resolveFusionCandidate, routePinnedModel, routeRequest, type RouteResult } from './router.js';
import { estimateInputTokens } from '../lib/content.js';
import type { ChatMessage, ChatToolCall } from '@omnipix/shared/types.js';
import { agentToolByName, resolveAgentTools } from './agent-tools.js';
import { maybeCheckpoint } from './checkpoints.js';
import { memoryPromptSection, recallForRun } from './memories.js';
import { evaluateToolCall, expireApproval, parkForApproval, waitForDecision } from '../lib/agent-policy.js';
import { runPostToolHooks, runPreToolHooks } from './agent-hooks.js';
import { resolveInRoot, runWorkspace } from '../lib/workspace.js';
import fs from 'node:fs';
import { detectChecks, runCheck, verifyFailurePrompt, type CheckResult } from './agent-verify.js';
import { learnFromRun } from './learning-loop.js';
import { createCheckpoint } from './checkpoints.js';
import { SPOTLIGHT_RULE, spotlight } from '../lib/spotlight.js';
import { FALLBACK_INPUT_PER_M, FALLBACK_OUTPUT_PER_M } from '../db/model-pricing.js';
import { emitWebhook } from './webhooks.js';

// The agent runtime: a tool loop over the gateway's own router. Every model
// call routes like any other request (auto-routing, failover, cooldowns),
// so runs are never pinned to one provider — the model is a preference,
// never a dependency. Steps persist as they land; live subscribers get the
// same events over SSE.

export const AGENT_TAG = 'agent';
export const AGENT_MAX_STEPS = 25;
export const AGENT_ATTEMPTS = 3;
/** Summarize-and-continue cycles after a step budget exhausts (default). */
export const AGENT_DEFAULT_COMPACTIONS = 1;
/** Hard ceiling on summarize-and-continue cycles per run. */
export const AGENT_MAX_COMPACTIONS = 3;
/** Cap on tools per run: 12 native plus headroom for MCP names. */
export const AGENT_MAX_TOOLS = 32;
/** Self-retry rounds after the repo checks fail on changed files. */
export const AGENT_VERIFY_ROUNDS = 2;
export const AGENT_TOOL_NAMES = [
  'calculator', 'current_time', 'web_search', 'fetch_url', 'memory_write', 'memory_read',
  'read_file', 'grep_search', 'write_file', 'edit_file', 'shell_exec', 'run_check',
  'blackboard_read', 'blackboard_write', 'remember', 'recall_memory',
  'git_status', 'git_diff', 'git_log', 'git_branch', 'git_commit', 'git_clone',
  'delegate', 'recall_docs', 'find_skill', 'todo_write',
];

export interface AgentRunOptions {
  goal: string;
  model?: string;
  tools?: string[];
  skills?: string[];
  maxSteps?: number;
  /** Hard token budget (prompt + completion); the run stops when reached. */
  maxTokens?: number;
  projectKey?: string;
  signal?: AbortSignal;
  /** Draft a tool-free plan and park for approval before acting. */
  planMode?: boolean;
  /**
   * Unattended execution: pending-tier calls run without parking. Internal
   * only — the eval runner sets it for coding-task items. Pre-tool hooks
   * still gate every call, and the row is flagged for every surface.
   */
  autoApprove?: boolean;
  /** Summarize-and-continue cycles after the step budget exhausts (0..3, default 1). */
  compactions?: number;
  /** Internal: rebuild context from the step log instead of starting fresh. Set only by resumeAgentRun. */
  __resume?: boolean;
}

export interface AgentStep {
  id: number;
  seq: number;
  kind: 'thought' | 'tool_call' | 'tool_result' | 'answer' | 'error' | 'check' | 'restore' | 'plan' | 'hook' | 'compact';
  name: string | null;
  /** Display label — always equals `name`; the UI and CLI read this. */
  label: string | null;
  content: Record<string, unknown>;
  created_at: string;
}

export interface AgentRun {
  id: number;
  goal: string;
  model: string;
  tools: string[];
  skills: string[];
  session_id: number | null;
  status: 'running' | 'done' | 'error' | 'stopped' | 'awaiting_approval';
  final_answer: string | null;
  error: string | null;
  steps_used: number;
  prompt_tokens: number;
  completion_tokens: number;
  /** Paid-equivalent $ estimate from the models pricing table (0 when free/unknown). Computed at read. */
  cost_usd: number;
  plan_mode: number;
  parent_run_id: number | null;
  auto_approve: number;
  created_at: string;
  finished_at: string | null;
  steps: AgentStep[];
}

export interface SkillRow {
  name: string;
  description: string;
  instructions: string;
  enabled: number;
  builtin: number;
  /** Bundle member names, when this skill expands to several skills. */
  bundle?: string[] | null;
}

export function listSkills(enabledOnly = false): SkillRow[] {
  const db = getDb();
  const rows = (enabledOnly
    ? db.prepare('SELECT * FROM skills WHERE enabled = 1 ORDER BY name').all()
    : db.prepare('SELECT * FROM skills ORDER BY name').all()) as Array<SkillRow & { bundle_json?: string | null }>;
  return rows.map(row => {
    let bundle: string[] | null = null;
    if (row.bundle_json) {
      try {
        const parsed: unknown = JSON.parse(row.bundle_json);
        if (Array.isArray(parsed)) bundle = parsed.filter((m): m is string => typeof m === 'string');
      } catch {
        // A corrupt bundle degrades to a plain skill; the row still loads.
      }
    }
    return { ...row, bundle };
  });
}

/**
 * Pick skills for a goal. Explicit names win (unknown ones are ignored);
 * otherwise score enabled skills by keyword overlap with the goal and take
 * the top two above the floor. Pure function of (goal, skills) — tested.
 */
const SLASH_RE = /^((?:\/[a-z0-9][a-z0-9-]*)(?:[ \t]+\/[a-z0-9][a-z0-9-]*)*)(?=[ \t]+|$)/;

/**
 * Explicit skill invocation: leading `/name` tokens (`/planner /coder do
 * the thing`) attach skills and strip to the bare goal. Only the leading
 * position parses, and path-like text (`/tmp/x`, `/v1/models`) never
 * matches — the token must be followed by whitespace or end right there.
 * Pure — tested.
 */
export function parseSlashSkills(goal: string): { skills: string[]; goal: string } {
  const match = SLASH_RE.exec(goal.trimStart());
  if (!match) return { skills: [], goal };
  const skills = [...new Set(match[1].split(/[ \t]+/).map(t => t.slice(1)))];
  return { skills, goal: goal.trimStart().slice(match[0].length).trimStart() };
}

export function selectSkills(goal: string, skills: SkillRow[], explicit?: string[]): SkillRow[] {
  // Bundle members resolve to the member rows (enabled only); unknown or
  // disabled members drop. One level: members never re-expand.
  const expand = (picked: SkillRow[]): SkillRow[] => {
    const byName = new Map(skills.filter(s => s.enabled).map(s => [s.name, s]));
    const out: SkillRow[] = [];
    const seen = new Set<string>();
    for (const skill of picked) {
      const members = skill.bundle?.length
        ? skill.bundle.map(n => byName.get(n)).filter((s): s is SkillRow => !!s)
        : [skill];
      for (const member of members) {
        if (seen.has(member.name)) continue;
        seen.add(member.name);
        out.push(member);
      }
    }
    return out;
  };
  if (explicit?.length) {
    const byName = new Map(skills.filter(s => s.enabled).map(s => [s.name, s]));
    return expand(explicit.map(n => byName.get(n)).filter((s): s is SkillRow => !!s));
  }
  const words = new Set(goal.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3));
  if (!words.size) return [];
  // Weighted fields: a name hit means the goal names the discipline, a
  // description hit means topical overlap, an instructions hit is weak
  // evidence (long bodies match everything). Threshold 2 keeps precision
  // as the library grows into the hundreds.
  const scored = skills
    .filter(s => s.enabled)
    .map(skill => {
      const name = skill.name.toLowerCase();
      const desc = skill.description.toLowerCase();
      const instr = skill.instructions.toLowerCase();
      let score = 0;
      for (const word of words) {
        if (name.includes(word)) score += 3;
        else if (desc.includes(word)) score += 2;
        else if (instr.includes(word)) score += 1;
      }
      return { skill, score };
    })
    .filter(e => e.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map(e => e.skill);
  return expand(scored);
}

/** Max repo-convention chars injected (CLAUDE.md + AGENTS.md combined). */
export const REPO_CONVENTIONS_CHARS = 8000;

/**
 * Repository conventions for a run: the workspace's CLAUDE.md and AGENTS.md,
 * the files repos use to instruct agents. Read at start (missing files are
 * fine), capped, and labeled with provenance so the model weighs them as
 * project instructions — below the operator goal, above tool output.
 */
export function repoConventions(runId: number): string {
  const files: string[] = [];
  for (const name of ['CLAUDE.md', 'AGENTS.md']) {
    try {
      const abs = resolveInRoot(runWorkspace(runId), name);
      const content = fs.readFileSync(abs, 'utf8').trim();
      if (content) files.push(`--- ${name} ---\n${content}`);
    } catch {
      // Absent or unreadable: no conventions from this file.
    }
  }
  if (!files.length) return '';
  const joined = files.join('\n\n').slice(0, REPO_CONVENTIONS_CHARS);
  return `Repository conventions (project instructions, below the operator goal in precedence):\n${joined}`;
}

/** Max instructions chars injected per skill; long registry skills truncate with a marker. */
export const SKILL_INJECT_CHARS = 6000;

export function skillPromptBlock(skill: SkillRow): string {
  const body = skill.instructions.length > SKILL_INJECT_CHARS
    ? `${skill.instructions.slice(0, SKILL_INJECT_CHARS)}\n…(truncated to ${SKILL_INJECT_CHARS} chars; use find_skill for the full text)`
    : skill.instructions;
  return `## ${skill.name}\n${body}`;
}

function recordStep(runId: number, seq: number, kind: AgentStep['kind'], name: string | null, content: Record<string, unknown>): AgentStep {
  const db = getDb();
  const row = db.prepare(
    'INSERT INTO agent_steps (run_id, seq, kind, name, content_json) VALUES (?, ?, ?, ?, ?) RETURNING id, seq, kind, name, content_json, created_at',
  ).get(runId, seq, kind, name, JSON.stringify(content)) as { id: number; seq: number; kind: AgentStep['kind']; name: string | null; content_json: string; created_at: string };
  return { id: row.id, seq: row.seq, kind: row.kind, name: row.name, label: row.name, content: JSON.parse(row.content_json), created_at: row.created_at };
}

// Live subscribers per run id (SSE). In-process by design: runs execute on
// this process, so subscribers attach here; polling GET /:id covers the rest.
type RunListener = (event: { type: string; step?: AgentStep; run?: Partial<AgentRun> }) => void;
const runListeners = new Map<number, Set<RunListener>>();
const runControllers = new Map<number, AbortController>();

/** Abort a live run; the loop observes it at the next step boundary. */
export function stopAgentRun(id: number): void {
  runControllers.get(id)?.abort();
}

/**
 * Append a step outside the loop (restore records, operator notes).
 * Broadcasts to live SSE subscribers like loop steps do.
 */
export function appendStep(runId: number, kind: AgentStep['kind'], name: string | null, content: Record<string, unknown>): AgentStep {
  const db = getDb();
  const max = db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM agent_steps WHERE run_id = ?').get(runId) as { m: number };
  const row = recordStep(runId, max.m + 1, kind, name, content);
  emit(runId, { type: 'step', step: row });
  return row;
}

export function subscribeRun(runId: number, listener: RunListener): () => void {
  let set = runListeners.get(runId);
  if (!set) {
    set = new Set();
    runListeners.set(runId, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (!set!.size) runListeners.delete(runId);
  };
}

function emit(runId: number, event: { type: string; step?: AgentStep; tool?: string; run?: Partial<AgentRun>; data?: string; stream?: string }) {
  for (const listener of runListeners.get(runId) ?? []) {
    try {
      listener(event as { type: string; step?: AgentStep; run?: Partial<AgentRun> });
    } catch {
      // A broken subscriber must never break the run.
    }
  }
}

/**
 * Server-side execution trace, mirroring traceRouteEvent's one-line shape.
 * Steps already persist to agent_steps and SSE; this is the operator's
 * grep-able record of what ran, in order, with outcomes and durations.
 * Tool names only — arguments routinely carry secrets and paths, and the
 * step rows already hold whatever the dashboard needs.
 */
export function traceAgentEvent(
  runId: number,
  event: 'tool-start' | 'tool-ok' | 'tool-denied' | 'tool-error' | 'run-finish',
  opts: { seq?: number; tool?: string; status?: string; durationMs?: number } = {},
): void {
  const parts = ['[Agent]', new Date().toISOString().slice(11, 19), event, `run=${runId}`];
  if (opts.seq != null) parts.push(`step=${opts.seq}`);
  if (opts.tool) parts.push(`tool=${opts.tool}`);
  if (opts.status) parts.push(`status=${opts.status}`);
  if (opts.durationMs != null) parts.push(`dur=${opts.durationMs}ms`);
  console.log(parts.join(' '));
}

function finishRun(runId: number, patch: Partial<Pick<AgentRun, 'status' | 'final_answer' | 'error' | 'steps_used' | 'prompt_tokens' | 'completion_tokens'>>) {
  const db = getDb();
  const sets: string[] = ['finished_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\')'];
  const vals: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    sets.push(`${key} = ?`);
    vals.push(value);
  }
  db.prepare(`UPDATE agent_runs SET ${sets.join(', ')} WHERE id = ?`).run(...vals, runId);
  if (patch.status && patch.status !== 'running' && patch.status !== 'awaiting_approval') {
    const row = db.prepare('SELECT goal FROM agent_runs WHERE id = ?').get(runId) as { goal: string } | undefined;
    emitWebhook('run.finished', { runId, status: patch.status, goal: (row?.goal ?? '').slice(0, 500) });
    traceAgentEvent(runId, 'run-finish', { status: patch.status });
  }
}

function resolveRunModel(model: string): { dbId: number } | { auto: true } {
  if (!model || model === 'auto') return { auto: true };
  const candidate = resolveFusionCandidate(model, { allowGroupFallback: false });
  if (!candidate) throw new Error(`Unknown or disabled model: ${model}. Call /v1/models for the available list.`);
  return { dbId: candidate.modelDbId };
}

const SYSTEM_PROMPT = [
  'You are OmniPix Agent, a careful operator that achieves the user goal with tools.',
  'Rules: prefer the fewest tool calls that answer well; never invent tool results;',
  'when done, reply with ONLY the final answer (no tool call); if a tool errors,',
  'say what failed instead of guessing. For goals with 2+ steps, track them',
  'with todo_write and keep exactly one in progress.',
  SPOTLIGHT_RULE,
].join(' ');

const PLAN_SYSTEM_PROMPT = [
  'PLAN MODE: draft a concrete execution plan for the user goal and NOTHING else.',
  'Reply with only the numbered plan (name the tools and file paths you would use);',
  'do not act, do not ask questions — an operator approves the plan before anything executes.',
].join(' ');

// Transcript chars fed to the compaction summarizer (~6k tokens). Oldest
// lines drop first; the tail (recent tool results) always survives.
const COMPACT_TRANSCRIPT_CHARS = 24_000;

// Estimated input tokens that force an early compaction. Absolute on
// purpose: per-model windows vary by route, but anything past this is
// unsafe for the small-window models in the chain, and the emergency
// overflow path below still catches what estimation misses.
export const COMPACT_PRESSURE_TOKENS = 24_000;

const COMPACT_SYSTEM_PROMPT = [
  'Summarize this agent transcript so a fresh session can continue the SAME task without repeating work.',
  'Reply with only the summary, structured as: Goal / Progress (what was tried, with tool names, file paths, and key values) /',
  'Current state (files changed, test results, blockers) / Remaining work (concrete next steps).',
  'Be specific — names, paths, and values carry over; vague prose does not.',
].join(' ');

/**
 * Run the workspace's own checks, recording one `check` step per gate.
 * Harness-initiated (not a tool call), so policy does not gate it — the
 * sandbox (cwd lock, timeout, output cap) is the control. Never throws:
 * a crashing check runner reports as a failed check, not a dead run.
 */
async function runVerifyPhase(
  runId: number,
  step: (kind: AgentStep['kind'], name: string | null, content: Record<string, unknown>) => AgentStep,
  onOutput: (chunk: string, stream: 'stdout' | 'stderr') => void,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  let checks: ReturnType<typeof detectChecks> = [];
  try {
    checks = detectChecks(runWorkspace(runId));
  } catch {
    return results;
  }
  for (const check of checks) {
    try {
      const result = await runCheck(runWorkspace(runId), check, { onOutput });
      results.push(result);
      step('check', check.name, {
        pass: result.pass,
        command: result.command,
        exitCode: result.exitCode,
        summary: result.summary.slice(0, 2000),
      });
    } catch (err) {
      const failed: CheckResult = {
        name: check.name, command: check.command, pass: false,
        exitCode: null, timedOut: false,
        summary: `check runner error: ${err instanceof Error ? err.message : String(err)}`,
      };
      results.push(failed);
      step('check', check.name, { pass: false, command: check.command, summary: failed.summary });
    }
  }
  return results;
}

export async function executeAgentRun(runId: number, opts: AgentRunOptions): Promise<AgentRun> {
  const task = runLoop(runId, opts);
  liveLoops.add(task);
  try {
    const run = await task;
    // Learning loop (fire-and-forget, quiesced like loops): distill the
    // finished trace into reviewable skill/memory proposals.
    const learning = learnFromRun(runId).catch(() => undefined);
    liveLearning.add(learning);
    void learning.then(() => liveLearning.delete(learning));
    return run;
  } finally {
    liveLoops.delete(task);
  }
}

// Live loop tasks, so tests can quiesce background runs before resetting
// the DB: without this, a fire-and-forget loop from one test writes steps
// into the next test's same-id run after :memory: is re-initialized.
const liveLoops = new Set<Promise<AgentRun>>();

// Learning distillations in flight. Quiesced alongside loops so a proposal
// model call can't leak into the next test's fetch mock or database.
const liveLearning = new Set<Promise<unknown>>();

/**
 * Test seam: stop every live loop and wait for them to land (bounded).
 * Call BEFORE initDb in beforeEach.
 */
export async function __quiesceAgentRuns(timeoutMs = 10_000): Promise<void> {
  for (const controller of runControllers.values()) {
    try {
      controller.abort();
    } catch {
      // Already aborted — the loop is on its way out.
    }
  }
  const pending = [...liveLoops];
  runControllers.clear();
  // Loops settle first (each may spawn one learning task), then learning.
  await Promise.race([
    Promise.allSettled(pending),
    new Promise(resolve => setTimeout(resolve, timeoutMs)),
  ]);
  const learning = [...liveLearning];
  if (!learning.length) return;
  await Promise.race([
    Promise.allSettled(learning),
    new Promise(resolve => setTimeout(resolve, timeoutMs)),
  ]);
}

/**
 * Boot reconciliation: run loops are in-process, so any run still marked
 * running after a restart has no driver and would display as live work
 * forever. Fail it loudly instead. Runs with a live controller (mid-process
 * calls, i.e. tests) are skipped. Idempotent.
 */
export function reconcileOrphanedRuns(): number {
  const db = getDb();
  const rows = db.prepare("SELECT id FROM agent_runs WHERE status = 'running'").all() as { id: number }[];
  let orphaned = 0;
  for (const row of rows) {
    if (runControllers.has(row.id)) continue;
    db.prepare(
      `UPDATE agent_runs SET status = 'error', error = 'server restarted mid-run — review steps and re-run',
       finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    ).run(row.id);
    orphaned++;
  }
  return orphaned;
}

interface ResumeState {
  messages: ChatMessage[];
  seq: number;
  promptTokens: number;
  completionTokens: number;
}

/**
 * Rebuild model context from the durable step log so a dead run can resume
 * where it stopped. Tool pairs replay with deterministic call ids (the live
 * ids aren't stored); check phases replay as summaries; a compaction
 * restarts the replay from its summary like the live loop did. Tool content
 * is re-spotlighted — replayed history gets the same injection boundary.
 */
function rebuildTranscript(
  runId: number,
  goal: string,
  system: string,
  storedPrompt: number,
  storedCompletion: number,
): ResumeState {
  const db = getDb();
  const rows = db.prepare('SELECT seq, kind, name, content_json FROM agent_steps WHERE run_id = ? ORDER BY seq')
    .all(runId) as { seq: number; kind: string; name: string | null; content_json: string }[];
  const messages: ChatMessage[] = [
    { role: 'system', content: system } as ChatMessage,
    { role: 'user', content: goal } as ChatMessage,
  ];
  let startAt = 0;
  const lastCompact = [...rows].reverse().find(r => r.kind === 'compact');
  if (lastCompact) {
    try {
      const summary = (JSON.parse(lastCompact.content_json) as { summary?: string }).summary ?? '';
      messages.push(
        { role: 'assistant', content: `Session summary of previous work:\n${summary}` } as ChatMessage,
        { role: 'user', content: 'Continue working toward the goal above. Do not repeat completed steps.' } as ChatMessage,
      );
      startAt = rows.indexOf(lastCompact) + 1;
    } catch {
      // Corrupt summary: replay everything instead of resuming blind.
    }
  }
  const pending: string[] = [];
  const parse = (json: string): Record<string, unknown> => {
    try {
      return JSON.parse(json) as Record<string, unknown>;
    } catch {
      return {};
    }
  };
  for (const row of rows.slice(startAt)) {
    const content = parse(row.content_json);
    if (row.kind === 'thought' && typeof content.text === 'string' && content.text) {
      messages.push({ role: 'assistant', content: content.text } as ChatMessage);
    } else if (row.kind === 'tool_call') {
      const id = `resumed-${row.seq}`;
      pending.push(id);
      messages.push({
        role: 'assistant',
        content: '',
        tool_calls: [{ id, type: 'function', function: { name: row.name ?? '', arguments: JSON.stringify(content.arguments ?? {}) } }],
      } as unknown as ChatMessage);
    } else if (row.kind === 'tool_result') {
      const id = pending.shift() ?? `resumed-${row.seq}`;
      messages.push({ role: 'tool', tool_call_id: id, content: spotlight(row.name ?? 'tool', String(content.result ?? '')) } as ChatMessage);
    } else if (row.kind === 'answer' && typeof content.text === 'string' && content.text) {
      messages.push({ role: 'assistant', content: content.text } as ChatMessage);
    } else if (row.kind === 'check') {
      messages.push({ role: 'user', content: `Verification check ${row.name ?? ''}: ${JSON.stringify(content).slice(0, 1000)}` } as ChatMessage);
    }
    // error/restore/plan/hook/compact steps are harness metadata, not dialogue.
  }
  return {
    messages,
    seq: rows.length ? rows[rows.length - 1].seq : 0,
    promptTokens: storedPrompt,
    completionTokens: storedCompletion,
  };
}

interface ResumeRow {
  goal: string; model: string; tools_json: string; skills_json: string; status: string;
  project_key: string; plan_mode: number; auto_approve: number;
  prompt_tokens: number; completion_tokens: number;
}

/** Synchronous resume guards, so the route answers 4xx before launching. */
export function assertResumable(runId: number): ResumeRow {
  const row = getDb().prepare('SELECT * FROM agent_runs WHERE id = ?').get(runId) as ResumeRow | undefined;
  if (!row) throw new Error(`Run ${runId} not found`);
  if (runControllers.has(runId)) throw new Error(`Run ${runId} is already live`);
  if (row.status === 'running') throw new Error(`Run ${runId} is marked running with no driver; restart the server to reconcile it first`);
  if (row.status === 'awaiting_approval') throw new Error(`Run ${runId} is parked; decide the pending approval instead of resuming`);
  if (row.status !== 'error' && row.status !== 'stopped') throw new Error(`Only errored or stopped runs resume (run ${runId} is ${row.status})`);
  return row;
}

/**
 * Resume a dead run (error/stopped) where it stopped: the step log replays
 * into model context and the loop continues with a fresh turn budget while
 * token totals carry over for honest cost. Refuses live or parked runs.
 */
export async function resumeAgentRun(runId: number, opts?: { maxSteps?: number; signal?: AbortSignal }): Promise<AgentRun> {
  const db = getDb();
  const row = assertResumable(runId);
  db.prepare("UPDATE agent_runs SET status = 'running', error = NULL, finished_at = NULL WHERE id = ?").run(runId);
  const task = runLoop(runId, {
    goal: row.goal,
    model: row.model,
    tools: JSON.parse(row.tools_json),
    skills: JSON.parse(row.skills_json),
    maxSteps: opts?.maxSteps,
    projectKey: row.project_key,
    autoApprove: row.auto_approve === 1,
    signal: opts?.signal,
    __resume: true,
  });
  liveLoops.add(task);
  try {
    const run = await task;
    const learning = learnFromRun(runId).catch(() => undefined);
    liveLearning.add(learning);
    void learning.then(() => liveLearning.delete(learning));
    return run;
  } finally {
    liveLoops.delete(task);
  }
}

async function runLoop(runId: number, opts: AgentRunOptions): Promise<AgentRun> {
  const db = getDb();
  const maxSteps = Math.min(AGENT_MAX_STEPS, Math.max(1, opts.maxSteps ?? 8));
  const requestedTools = opts.tools?.length
    ? opts.tools.filter(name => agentToolByName(name))
    : AGENT_TOOL_NAMES;
  if (opts.tools?.length && !requestedTools.length) {
    throw new Error(`No known tools in: ${opts.tools.join(', ')}. Known: ${AGENT_TOOL_NAMES.join(', ')}`);
  }
  const toolDefs = await resolveAgentTools(requestedTools);
  const skills = selectSkills(opts.goal, listSkills(), opts.skills);
  const resolved = resolveRunModel(opts.model ?? 'auto');
  const controller = new AbortController();
  runControllers.set(runId, controller);
  const onCallerAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onCallerAbort, { once: true });
  const signal = controller.signal;

  db.prepare('UPDATE agent_runs SET model = ?, tools_json = ?, skills_json = ? WHERE id = ?').run(
    opts.model ?? 'auto', JSON.stringify(requestedTools), JSON.stringify(skills.map(s => s.name)), runId,
  );

  const recalled = recallForRun(opts.projectKey?.trim() ?? '');
  const system = [
    SYSTEM_PROMPT,
    skills.length ? `Active skills:\n${skills.map(skillPromptBlock).join('\n\n')}` : '',
    repoConventions(runId),
    memoryPromptSection(recalled),
  ].filter(Boolean).join('\n\n');
  let messages: ChatMessage[] = [
    { role: 'system', content: system } as ChatMessage,
    { role: 'user', content: opts.goal } as ChatMessage,
  ];

  let seq = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  if (opts.__resume) {
    const stored = db.prepare('SELECT prompt_tokens, completion_tokens FROM agent_runs WHERE id = ?').get(runId) as { prompt_tokens: number; completion_tokens: number };
    const rebuilt = rebuildTranscript(runId, opts.goal, system, stored.prompt_tokens, stored.completion_tokens);
    messages = rebuilt.messages;
    seq = rebuilt.seq;
    promptTokens = rebuilt.promptTokens;
    completionTokens = rebuilt.completionTokens;
  }
  const resumed = opts.__resume === true;
  let verifyRounds = 0;
  const dirtyFiles = new Set<string>();
  const step = (kind: AgentStep['kind'], name: string | null, content: Record<string, unknown>): AgentStep => {
    seq++;
    const row = recordStep(runId, seq, kind, name, content);
    emit(runId, { type: 'step', step: row });
    return row;
  };
  // Live shell/check output for the terminal view. Best-effort: subscribers
  // may be absent; the capped result still lands in the tool_result step.
  const onToolOutput = (chunk: string, stream: 'stdout' | 'stderr'): void => {
    emit(runId, { type: 'terminal', data: chunk.slice(0, 8000), stream });
  };
  // Only successful file mutations arm verification — shell_exec may change
  // files invisibly, but gating on every shell call would re-run the suite
  // after read-only commands too. run_check IS verification already.
  const markDirty = (toolName: string, args: Record<string, unknown>): void => {
    if ((toolName === 'write_file' || toolName === 'edit_file') && typeof args.path === 'string') {
      dirtyFiles.add(args.path);
    }
  };
  if (resumed) {
    step('restore', null, { message: 'Run resumed; transcript rebuilt from the step log.' });
  }

  const getRoute = (skipKeys: Set<string>, skipModels: Set<number>): RouteResult | null => {
    try {
      if ('auto' in resolved) {
        return routeRequest(estimateInputTokens(messages) + 1024, skipKeys, undefined, false, true, skipModels);
      }
      if (!pinnedModelFitsRequestSize(resolved.dbId, estimateInputTokens(messages) + 1024)) return null;
      return routePinnedModel(resolved.dbId, estimateInputTokens(messages) + 1024, skipKeys);
    } catch {
      return null;
    }
  };

  const release = () => {
    opts.signal?.removeEventListener('abort', onCallerAbort);
    runControllers.delete(runId);
  };
  const finishStopped = (): AgentRun => {
    step('error', null, { message: 'stopped' });
    finishRun(runId, { status: 'stopped', error: 'stopped', steps_used: seq, prompt_tokens: promptTokens, completion_tokens: completionTokens });
    emit(runId, { type: 'done', run: { status: 'stopped' } });
    release();
    return getAgentRun(runId)!;
  };

  // Plan mode: one tool-free turn drafts the plan, then the run parks in
  // the approvals inbox. Approval resumes into the normal loop below with
  // the plan as conversation history; denial stops the run unexecuted.
  if (opts.planMode && !signal.aborted) {
    const planOutcome = await runModelCall(
      getRoute,
      [
        { role: 'system', content: `${system}\n\n${PLAN_SYSTEM_PROMPT}` } as ChatMessage,
        { role: 'user', content: opts.goal } as ChatMessage,
      ],
      { max_tokens: 2048 },
      estimateInputTokens(messages) + 1024,
      AGENT_ATTEMPTS,
      undefined,
      AGENT_TAG,
    );
    if (planOutcome.usage) {
      promptTokens += planOutcome.usage.prompt_tokens ?? 0;
      completionTokens += planOutcome.usage.completion_tokens ?? 0;
    }
    if (!planOutcome.ok) {
      const message = planOutcome.error ?? 'plan draft failed';
      step('error', null, { message });
      finishRun(runId, { status: 'error', error: message, steps_used: seq, prompt_tokens: promptTokens, completion_tokens: completionTokens });
      emit(runId, { type: 'done', run: { status: 'error' } });
      release();
      return getAgentRun(runId)!;
    }
    // The plan turn offers no tools, so conforming providers return no
    // calls; if one does anyway, drop them — nothing may act pre-approval.
    const planText = planOutcome.text?.trim() || '(the model returned an empty plan)';
    const planStep = step('plan', 'plan', { text: planText });
    const planApprovalId = parkForApproval(runId, planStep.seq, 'plan', { plan: planText });
    emit(runId, { type: 'awaiting', run: { status: 'awaiting_approval' } });
    const planApproved = await waitForDecision(planApprovalId, signal);
    if (signal.aborted) {
      expireApproval(planApprovalId);
      return finishStopped();
    }
    if (!planApproved) {
      step('error', null, { message: 'plan denied by operator' });
      finishRun(runId, { status: 'stopped', error: 'plan denied by operator', steps_used: seq, prompt_tokens: promptTokens, completion_tokens: completionTokens });
      emit(runId, { type: 'done', run: { status: 'stopped' } });
      release();
      return getAgentRun(runId)!;
    }
    messages.push({ role: 'assistant', content: planText } as ChatMessage);
    messages.push({ role: 'user', content: 'Plan approved — execute it now with tools.' } as ChatMessage);
  }

  // Context compaction: when the turn budget exhausts, summarize the
  // transcript and continue with a fresh message list instead of dying.
  // Bounded by maxCompactions — a run that never converges still ends.
  const maxCompactions = Math.min(AGENT_MAX_COMPACTIONS, Math.max(0, opts.compactions ?? AGENT_DEFAULT_COMPACTIONS));
  let compactionsUsed = 0;
  let turnsLeft = maxSteps;
  const maxTokens = opts.maxTokens != null && Number.isFinite(opts.maxTokens) && opts.maxTokens > 0
    ? Math.floor(opts.maxTokens)
    : null;

  const finishExhausted = (message: string): AgentRun => {
    step('error', null, { message });
    finishRun(runId, {
      status: 'error', error: message,
      steps_used: seq, prompt_tokens: promptTokens, completion_tokens: completionTokens,
    });
    emit(runId, { type: 'done', run: { status: 'error' } });
    release();
    return getAgentRun(runId)!;
  };

  const summarizeTranscript = async (): Promise<string | null> => {
    const lines: string[] = [];
    for (const message of messages) {
      if (message.role === 'system') continue; // rebuilt identically; drop to save room
      const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? '');
      if (message.role === 'assistant') {
        const calls = (message.tool_calls ?? [])
          .map(c => `${c.function.name}(${(c.function.arguments || '').slice(0, 300)})`)
          .join(', ');
        lines.push(`assistant: ${content.slice(0, 1000)}${calls ? ` [tools: ${calls}]` : ''}`);
      } else if (message.role === 'tool') {
        lines.push(`tool result: ${content.slice(0, 1000)}`);
      } else {
        lines.push(`${message.role}: ${content.slice(0, 1000)}`);
      }
    }
    let transcript = lines.join('\n');
    while (transcript.length > COMPACT_TRANSCRIPT_CHARS && lines.length > 20) {
      lines.shift();
      transcript = lines.join('\n');
    }
    const outcome = await runModelCall(
      getRoute,
      [
        { role: 'system', content: COMPACT_SYSTEM_PROMPT } as ChatMessage,
        { role: 'user', content: `Original goal: ${opts.goal}\n\nTranscript:\n${transcript}` } as ChatMessage,
      ],
      { max_tokens: 1024 },
      estimateInputTokens(messages) + 1024,
      AGENT_ATTEMPTS,
      undefined,
      AGENT_TAG,
    );
    if (outcome.usage) {
      promptTokens += outcome.usage.prompt_tokens ?? 0;
      completionTokens += outcome.usage.completion_tokens ?? 0;
    }
    if (!outcome.ok || !outcome.text?.trim()) return null;
    return outcome.text.trim();
  };

  // One compaction cycle: snapshot the workspace first (pre-compress
  // checkpoint), summarize, and restart the message list. Returns false
  // when compaction itself fails — callers end the run loudly.
  const doCompaction = async (trigger: 'budget' | 'pressure' | 'overflow'): Promise<boolean> => {
    try {
      createCheckpoint(runId, `pre-compact-${compactionsUsed + 1}`, seq);
    } catch {
      // A snapshot failure must never block compaction itself.
    }
    const summary = await summarizeTranscript();
    if (summary === null) return false;
    compactionsUsed++;
    step('compact', 'compact', { cycle: compactionsUsed, trigger, summary: summary.slice(0, 2000) });
    messages.length = 0;
    messages.push(
      { role: 'system', content: system } as ChatMessage,
      { role: 'user', content: opts.goal } as ChatMessage,
      { role: 'assistant', content: `Session summary of previous work:\n${summary}` } as ChatMessage,
      { role: 'user', content: 'Continue working toward the goal above. Do not repeat completed steps.' } as ChatMessage,
    );
    turnsLeft = maxSteps;
    return true;
  };

  for (;;) {
    if (signal.aborted) return finishStopped();
    if (maxTokens != null && promptTokens + completionTokens >= maxTokens) {
      return finishExhausted(`token budget exhausted after ${promptTokens + completionTokens} tokens (cap ${maxTokens})`);
    }
    if (turnsLeft <= 0) {
      if (compactionsUsed >= maxCompactions) break;
      // Never silently drop context: a failed compaction ends the run
      // loudly instead of continuing blind.
      if (!await doCompaction('budget')) {
        return finishExhausted(`step budget exhausted after ${maxSteps} steps (compaction ${compactionsUsed + 1} failed)`);
      }
      continue;
    }
    // Pressure trigger: a long transcript can fill the window long before
    // the step budget runs out. Compact early instead of dying at the cap.
    if (compactionsUsed < maxCompactions && estimateInputTokens(messages) > COMPACT_PRESSURE_TOKENS) {
      if (!await doCompaction('pressure')) {
        return finishExhausted(`context pressure exceeded with no usable compaction (cycle ${compactionsUsed + 1} failed)`);
      }
      continue;
    }
    turnsLeft--;
    const outcome = await runModelCall(
      getRoute,
      messages,
      { tools: toolDefs, max_tokens: 2048 },
      estimateInputTokens(messages) + 1024,
      AGENT_ATTEMPTS,
      undefined,
      AGENT_TAG,
    );
    if (outcome.usage) {
      promptTokens += outcome.usage.prompt_tokens ?? 0;
      completionTokens += outcome.usage.completion_tokens ?? 0;
    }
    if (!outcome.ok) {
      // Emergency recovery: the provider says the context overflowed.
      // Compact and retry the turn (refunded — it never executed) instead
      // of failing a run that still has budget and cycles left.
      if (outcome.failure === 'context_too_large' && compactionsUsed < maxCompactions && !signal.aborted) {
        turnsLeft++;
        if (await doCompaction('overflow')) continue;
      }
      const message = outcome.error ?? 'model call failed';
      step('error', null, { message });
      finishRun(runId, { status: 'error', error: message, steps_used: seq, prompt_tokens: promptTokens, completion_tokens: completionTokens });
      emit(runId, { type: 'done', run: { status: 'error' } });
      release();
      return getAgentRun(runId)!;
    }
    // Stale-op guard: a stop that landed during the model call wins over
    // whatever it returned — never execute its tools or accept its answer.
    if (signal.aborted) return finishStopped();
    const calls: ChatToolCall[] = outcome.toolCalls ?? [];
    if (outcome.text) step('thought', null, { text: outcome.text });
    if (!calls.length) {
      // Verification gate: files changed and rounds remain → run the repo's
      // own checks before accepting the answer. Failures feed back as a new
      // user turn so the model repairs instead of declaring victory.
      if (dirtyFiles.size > 0 && verifyRounds < AGENT_VERIFY_ROUNDS && !signal.aborted) {
        const results = await runVerifyPhase(runId, step, onToolOutput);
        if (results.length > 0 && results.some(r => !r.pass)) {
          verifyRounds++;
          messages.push({ role: 'user', content: verifyFailurePrompt(results) } as ChatMessage);
          continue;
        }
      }
      step('answer', null, { text: outcome.text ?? '' });
      finishRun(runId, {
        status: 'done', final_answer: outcome.text ?? '', steps_used: seq,
        prompt_tokens: promptTokens, completion_tokens: completionTokens,
      });
      emit(runId, { type: 'done', run: { status: 'done' } });
      release();
      return getAgentRun(runId)!;
    }
    // Include the assistant turn (with its tool calls) so the history stays
    // a valid conversation for the next step.
    messages.push({
      role: 'assistant',
      content: outcome.text ?? '',
      tool_calls: calls.map(c => ({ id: c.id, type: 'function' as const, function: { name: c.function.name, arguments: c.function.arguments } })),
    } as ChatMessage);
    for (const call of calls) {
      // Stale-op guard: a stop that landed mid-turn (during an earlier tool
      // in this same batch) must prevent every later tool from executing.
      if (signal.aborted) return finishStopped();
      const tool = agentToolByName(call.function.name);
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch {
        // Malformed arguments reach the tool as {} and fail validation there.
      }
      const callStep = step('tool_call', call.function.name, { arguments: args });
      let result: string;
      let toolOutcome: 'tool-ok' | 'tool-denied' | 'tool-error' = 'tool-ok';
      const toolStarted = Date.now();
      traceAgentEvent(runId, 'tool-start', { seq: callStep.seq, tool: call.function.name });
      const decision = tool ? evaluateToolCall(call.function.name) : 'deny';
      // Deterministic hooks run before human approval: a veto spares the
      // operator, and a post-hook observes every settled execution.
      const gate = decision === 'deny'
        ? { allowed: false as const }
        : await runPreToolHooks(runId, call.function.name, args, step, signal);
      if (decision === 'deny') {
        toolOutcome = tool ? 'tool-denied' : 'tool-error';
        result = tool
          ? `denied by policy: ${call.function.name} is not allowed in this run.`
          : `unknown tool: ${call.function.name}. Available: ${requestedTools.join(', ')}`;
      } else if (!gate.allowed) {
        toolOutcome = 'tool-denied';
        result = gate.reason ?? `denied by hook: ${call.function.name} was vetoed. Work around it or ask the user.`;
        // Unattended runs skip the inbox (the row is flagged auto_approve);
        // pre-tool hooks above still gated this call.
      } else if (decision === 'pending' && !opts.autoApprove) {
        let diffText: string | undefined;
        if (tool!.preview) {
          try {
            diffText = (await tool!.preview(args, { runId, signal })) ?? undefined;
          } catch {
            // A preview failure must never block the approval itself; the
            // inbox shows arguments without a diff.
          }
        }
        const approvalId = parkForApproval(runId, callStep.seq, call.function.name, args, diffText);
        emit(runId, { type: 'awaiting', run: { status: 'awaiting_approval' } });
        const approved = await waitForDecision(approvalId, signal);
        if (signal.aborted) {
          expireApproval(approvalId);
          return finishStopped();
        }
        if (!approved) {
          toolOutcome = 'tool-denied';
          result = `denied by operator: ${call.function.name} was not approved. Work around it or ask the user.`;
        } else {
          try {
            maybeCheckpoint(runId, call.function.name, args, callStep.seq);
            result = await tool!.execute(args, { runId, signal, onOutput: onToolOutput });
            markDirty(call.function.name, args);
            await runPostToolHooks(runId, call.function.name, args, { ok: true, result }, step, signal);
          } catch (err: unknown) {
            toolOutcome = 'tool-error';
            result = `tool error: ${err instanceof Error ? err.message : String(err)}`;
            await runPostToolHooks(runId, call.function.name, args, { ok: false, result }, step, signal);
          }
        }
      } else {
        try {
          maybeCheckpoint(runId, call.function.name, args, callStep.seq);
          result = await tool!.execute(args, { runId, signal, onOutput: onToolOutput });
          markDirty(call.function.name, args);
          await runPostToolHooks(runId, call.function.name, args, { ok: true, result }, step, signal);
        } catch (err: unknown) {
          toolOutcome = 'tool-error';
          result = `tool error: ${err instanceof Error ? err.message : String(err)}`;
          await runPostToolHooks(runId, call.function.name, args, { ok: false, result }, step, signal);
        }
      }
      traceAgentEvent(runId, toolOutcome, { seq: callStep.seq, tool: call.function.name, durationMs: Date.now() - toolStarted });
      step('tool_result', call.function.name, { result: result.slice(0, 8000) });
      // Spotlighted: the stored step keeps raw text for display, but the
      // model-bound copy is marked untrusted data (injection boundary).
      messages.push({ role: 'tool', tool_call_id: call.id, content: spotlight(call.function.name, result.slice(0, 8000)) } as ChatMessage);
    }
  }

  const cycles = compactionsUsed === 0
    ? ''
    : ` (and ${compactionsUsed} compaction${compactionsUsed === 1 ? '' : 's'})`;
  return finishExhausted(`step budget exhausted after ${maxSteps} steps${cycles}`);
}

export function createAgentRun(opts: AgentRunOptions & { sessionId?: number; parentRunId?: number }): number {
  const row = getDb().prepare(
    'INSERT INTO agent_runs (goal, model, tools_json, skills_json, status, session_id, project_key, plan_mode, parent_run_id, auto_approve) VALUES (?, ?, ?, ?, \'running\', ?, ?, ?, ?, ?) RETURNING id',
  ).get(opts.goal, opts.model ?? 'auto', JSON.stringify(opts.tools ?? []), JSON.stringify(opts.skills ?? []), opts.sessionId ?? null, opts.projectKey?.trim() ?? '', opts.planMode ? 1 : 0, opts.parentRunId ?? null, opts.autoApprove ? 1 : 0) as { id: number };
  return row.id;
}

/**
 * Paid-equivalent $ estimate for token usage on one model id: the cheapest
 * priced catalog row wins (free-tier routing prefers cheap models, so the
 * minimum is the honest estimate), else the global fallback rates. Rounded to microdollars so small runs don't read $0; pure read, no writes.
 */
export function estimateCostUsd(modelId: string, promptTokens: number, completionTokens: number): number {
  const db = getDb();
  let inputPerM: number | null = null;
  let outputPerM: number | null = null;
  try {
    const rows = db.prepare(
      'SELECT paid_input_per_m AS i, paid_output_per_m AS o FROM models WHERE model_id = ? AND paid_input_per_m IS NOT NULL',
    ).all(modelId) as { i: number | null; o: number | null }[];
    for (const row of rows) {
      if (row.i != null && (inputPerM == null || row.i < inputPerM)) inputPerM = row.i;
      if (row.o != null && (outputPerM == null || row.o < outputPerM)) outputPerM = row.o;
    }
  } catch {
    // Pricing columns predate some test schemas; fall back to defaults.
  }
  const cost = (promptTokens * (inputPerM ?? FALLBACK_INPUT_PER_M) + completionTokens * (outputPerM ?? FALLBACK_OUTPUT_PER_M)) / 1_000_000;
  return Math.round(cost * 1000000) / 1000000;
}

export function getAgentRun(id: number): AgentRun | null {
  const db = getDb();
  const run = db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(id) as Omit<AgentRun, 'tools' | 'skills' | 'steps' | 'cost_usd' | 'tools_json' | 'skills_json'> & { tools_json: string; skills_json: string } | undefined;
  if (!run) return null;
  const steps = db.prepare('SELECT id, seq, kind, name, content_json, created_at FROM agent_steps WHERE run_id = ? ORDER BY seq').all(id) as Array<Omit<AgentStep, 'content'> & { content_json: string }>;
  return {
    ...run,
    tools: JSON.parse(run.tools_json),
    skills: JSON.parse(run.skills_json),
    cost_usd: estimateCostUsd(run.model, run.prompt_tokens, run.completion_tokens),
    steps: steps.map(s => ({ ...s, label: s.name, content: JSON.parse(s.content_json) })),
  };
}

export function listAgentRuns(limit = 20, sessionId?: number): Array<Omit<AgentRun, 'steps'>> {
  const db = getDb();
  const capped = Math.min(100, Math.max(1, limit));
  const rows = (sessionId === undefined
    ? db.prepare('SELECT * FROM agent_runs ORDER BY id DESC LIMIT ?').all(capped)
    : db.prepare('SELECT * FROM agent_runs WHERE session_id = ? ORDER BY id DESC LIMIT ?').all(sessionId, capped)
  ) as Array<Omit<AgentRun, 'tools' | 'skills' | 'steps' | 'cost_usd'> & { tools_json: string; skills_json: string }>;
  return rows.map(run => ({
    ...run,
    tools: JSON.parse(run.tools_json),
    skills: JSON.parse(run.skills_json),
    cost_usd: estimateCostUsd(run.model, run.prompt_tokens, run.completion_tokens),
  }));
}
