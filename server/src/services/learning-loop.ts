import { getDb } from '../db/index.js';
import { estimateInputTokens } from '../lib/content.js';
import { runModelCall } from './fusion.js';
import { routeRequest } from './router.js';
import { rememberMemory } from './memories.js';
import type { ChatMessage } from '@omnipix/shared/types.js';

// Learning loop (orchestration #6, Hermes shape, SQLite scale): finished
// runs teach the platform. Rich runs (many steps, varied tools) yield skill
// proposals drafted by a model call; repeated identical tool failures yield
// deterministic memory nudges. NOTHING applies itself — every proposal waits
// in learning_proposals for operator accept/discard. Past runs stay
// searchable through the runs_fts index.

export const SKILL_MIN_STEPS = 6;
export const SKILL_MIN_TOOLS = 3;
export const MAX_PENDING_PROPOSALS = 3;
export const ERROR_REPEAT_THRESHOLD = 3;

export interface SkillProposalBody {
  name: string;
  description: string;
  instructions: string;
}

export interface MemoryProposalBody {
  key: string;
  value: string;
  scope: 'user' | 'project' | 'entity';
  projectKey: string;
  importance?: number;
}

/**
 * Quarantine an agent-proposed memory for operator review instead of writing
 * it straight into durable memory. Agent writes are the self-poisoning loop:
 * a confused or injected run persisting its own bad instructions, which then
 * inject into every future prompt. Returns the proposal id, or the existing
 * pending id when the same key is already queued.
 */
export function proposeMemory(input: {
  key: string;
  value: string;
  scope: 'user' | 'project' | 'entity';
  projectKey?: string;
  importance?: number;
  runId?: number;
}): number {
  const db = getDb();
  const key = input.key.trim().slice(0, 128);
  if (!key) throw new Error('memory key must be a non-empty string');
  const scope = input.scope;
  const projectKey = input.projectKey?.trim() || '';
  if (scope === 'project' && !projectKey) throw new Error('project memories need a project key');
  const existing = db.prepare(
    "SELECT id FROM learning_proposals WHERE status = 'pending' AND kind = 'memory' AND title = ?",
  ).get(key) as { id: number } | undefined;
  if (existing) return existing.id;
  const body: MemoryProposalBody = {
    key,
    value: input.value.slice(0, 2000),
    scope,
    projectKey,
    importance: input.importance,
  };
  const row = db.prepare(
    "INSERT INTO learning_proposals (kind, title, body_json, source_run_id, status) VALUES ('memory', ?, ?, ?, 'pending') RETURNING id",
  ).get(key, JSON.stringify(body), input.runId ?? null) as { id: number };
  return row.id;
}

export interface ProposalRow {
  id: number;
  kind: 'skill' | 'memory';
  title: string;
  body_json: string;
  source_run_id: number | null;
  status: string;
  created_at: string;
}

interface RunRow {
  id: number;
  goal: string;
  model: string;
  status: string;
  final_answer: string | null;
  error: string | null;
  steps_used: number;
  project_key: string;
}

interface StepRow {
  kind: string;
  name: string | null;
  content_json: string;
}

const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

const DISTILL_SYSTEM = [
  'Distill ONE reusable skill from this agent run trace.',
  'Reply with ONLY a JSON object: {"name": "lowercase-letters-and-dashes", "description": "one sentence", "instructions": "3-8 imperative bullets, one per line"}.',
  'The skill must generalize beyond this exact task. If nothing reusable happened, reply exactly: {"name": "", "description": "", "instructions": ""}.',
].join(' ');

function pendingCount(): number {
  return (getDb().prepare("SELECT COUNT(*) AS n FROM learning_proposals WHERE status = 'pending'").get() as { n: number }).n;
}

function readRun(runId: number): { run: RunRow; steps: StepRow[] } | null {
  const db = getDb();
  const run = db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(runId) as RunRow | undefined;
  if (!run) return null;
  const steps = db.prepare('SELECT kind, name, content_json FROM agent_steps WHERE run_id = ? ORDER BY seq').all(runId) as StepRow[];
  return { run, steps };
}

function distinctTools(steps: StepRow[]): string[] {
  return [...new Set(steps.filter(s => s.kind === 'tool_call' && s.name).map(s => s.name as string))];
}

function traceDigest(steps: StepRow[]): string {
  return steps.slice(-40).map(step => {
    if (step.kind === 'tool_call') return `call ${step.name}`;
    if (step.kind === 'tool_result') {
      try {
        const content = JSON.parse(step.content_json) as { result?: string };
        const result = String(content.result ?? '');
        return result.startsWith('tool error:') ? `error: ${result.slice(0, 160)}` : 'ok';
      } catch {
        return 'ok';
      }
    }
    if (step.kind === 'answer') return 'answered';
    return step.kind;
  }).join('\n');
}

/**
 * Learn from a finished run: maybe a skill proposal (rich runs), maybe a
 * memory nudge (repeated identical tool failures). Best-effort — failures
 * resolve to null, never throw into the run path.
 */
export async function learnFromRun(runId: number): Promise<void> {
  try {
    await learnFromRunInner(runId);
  } catch {
    // Opportunistic by design: learning must never fail a run.
  }
}

async function learnFromRunInner(runId: number): Promise<void> {
  const loaded = readRun(runId);
  if (!loaded) return;
  const { run, steps } = loaded;
  if (pendingCount() >= MAX_PENDING_PROPOSALS) return;

  // Deterministic nudge first: the same tool failing identically 3+ times
  // is a lesson even when the run ultimately finished or died.
  const failures = new Map<string, { tool: string; error: string; count: number }>();
  for (const step of steps) {
    if (step.kind !== 'tool_result') continue;
    let result = '';
    try {
      result = String((JSON.parse(step.content_json) as { result?: string }).result ?? '');
    } catch {
      continue;
    }
    if (!result.startsWith('tool error:')) continue;
    const error = result.slice('tool error: '.length, 'tool error: '.length + 120);
    // Attribute to the nearest preceding tool call.
    const idx = steps.indexOf(step);
    const call = [...steps.slice(0, idx)].reverse().find(s => s.kind === 'tool_call');
    const tool = call?.name ?? 'unknown';
    const key = `${tool}\0${error}`;
    const entry = failures.get(key) ?? { tool, error, count: 0 };
    entry.count++;
    failures.set(key, entry);
  }
  for (const { tool, error, count } of failures.values()) {
    if (count < ERROR_REPEAT_THRESHOLD) continue;
    const scope = run.project_key ? 'project' : 'user';
    const key = `lesson-${tool}`;
    const existing = getDb().prepare(
      "SELECT id FROM learning_proposals WHERE status = 'pending' AND kind = 'memory' AND title = ?",
    ).get(key);
    if (existing) continue;
    const body: MemoryProposalBody = {
      key,
      value: `Calling ${tool} failed ${count} times in run #${runId} ("${run.goal.slice(0, 120)}") with: ${error}. Double-check arguments before retrying this call.`,
      scope,
      projectKey: run.project_key,
    };
    getDb().prepare(
      "INSERT INTO learning_proposals (kind, title, body_json, source_run_id, status) VALUES ('memory', ?, ?, ?, 'pending')",
    ).run(key, JSON.stringify(body), runId);
    return; // one nudge per run; the queue stays reviewable
  }

  // Skill distillation: rich, successful runs only.
  if (run.status !== 'done') return;
  if (run.steps_used < SKILL_MIN_STEPS) return;
  const tools = distinctTools(steps);
  if (tools.length < SKILL_MIN_TOOLS) return;
  // Fresh names only — never propose over an existing skill.
  const messages = [
    { role: 'system', content: DISTILL_SYSTEM },
    {
      role: 'user',
      content: `Goal: ${run.goal.slice(0, 500)}\nTools used: ${tools.join(', ')}\n\nTrace:\n${traceDigest(steps)}`,
    },
  ] as ChatMessage[];
  const estimated = estimateInputTokens(messages) + 512;
  const outcome = await runModelCall(
    (skipKeys, skipModels) => routeRequest(estimated, skipKeys, undefined, false, true, skipModels),
    messages,
    { max_tokens: 512 },
    estimated,
    2,
    undefined,
    'agent-learning',
  );
  if (!outcome.ok || !outcome.text?.trim()) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(outcome.text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, ''));
  } catch {
    return;
  }
  const draft = parsed as Partial<SkillProposalBody>;
  if (!draft.name || !SKILL_NAME_RE.test(draft.name) || !draft.description?.trim() || !draft.instructions?.trim()) return;
  const taken = getDb().prepare('SELECT 1 FROM skills WHERE name = ?').get(draft.name);
  if (taken) return;
  const dupe = getDb().prepare("SELECT 1 FROM learning_proposals WHERE status = 'pending' AND title = ?").get(draft.name);
  if (dupe) return;
  const body: SkillProposalBody = {
    name: draft.name,
    description: draft.description.trim().slice(0, 500),
    instructions: draft.instructions.trim().slice(0, 4000),
  };
  getDb().prepare(
    "INSERT INTO learning_proposals (kind, title, body_json, source_run_id, status) VALUES ('skill', ?, ?, ?, 'pending')",
  ).run(body.name, JSON.stringify(body), runId);
}

export function listProposals(status = 'pending'): ProposalRow[] {
  return getDb().prepare('SELECT * FROM learning_proposals WHERE status = ? ORDER BY id DESC LIMIT 50')
    .all(status) as ProposalRow[];
}

/**
 * Accept (materialize) or discard a proposal. Accepting a skill whose name
 * was taken meanwhile fails loudly instead of overwriting.
 */
export function resolveProposal(id: number, accept: boolean): ProposalRow {
  const db = getDb();
  const row = db.prepare('SELECT * FROM learning_proposals WHERE id = ?').get(id) as ProposalRow | undefined;
  if (!row) throw new Error('Proposal not found');
  if (row.status !== 'pending') throw new Error(`Proposal is already ${row.status}`);
  if (accept) {
    if (row.kind === 'skill') {
      const body = JSON.parse(row.body_json) as SkillProposalBody;
      const taken = db.prepare('SELECT 1 FROM skills WHERE name = ?').get(body.name);
      if (taken) throw new Error(`Skill already exists: ${body.name}`);
      db.prepare('INSERT INTO skills (name, description, instructions, enabled, builtin) VALUES (?, ?, ?, 1, 0)')
        .run(body.name, body.description, body.instructions);
    } else if (row.kind === 'memory') {
      const body = JSON.parse(row.body_json) as MemoryProposalBody;
      rememberMemory({ scope: body.scope, projectKey: body.projectKey, key: body.key, value: body.value, importance: body.importance, source: 'learning-loop', runId: row.source_run_id ?? undefined });
    } else {
      throw new Error(`Unknown proposal kind: ${row.kind}`);
    }
  }
  db.prepare("UPDATE learning_proposals SET status = ? WHERE id = ?").run(accept ? 'accepted' : 'discarded', id);
  return db.prepare('SELECT * FROM learning_proposals WHERE id = ?').get(id) as ProposalRow;
}

function ftsQuery(query: string): string | null {
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 2);
  if (!words.length) return null;
  return [...new Set(words)].map(w => `"${w.replace(/"/g, '')}"`).join(' AND ');
}

export interface RunHit {
  id: number;
  goal: string;
  final_answer: string | null;
  status: string;
  steps_used: number;
  created_at: string;
}

/** Full-text search over past run goals and answers, best first. */
export function searchRuns(query: string, limit = 10): RunHit[] {
  const match = ftsQuery(query);
  if (!match) return [];
  const capped = Math.min(50, Math.max(1, limit));
  return getDb().prepare(
    `SELECT rowid AS id, goal,
            substr(final_answer, 1, 500) AS final_answer,
            (SELECT status FROM agent_runs WHERE id = runs_fts.rowid) AS status,
            (SELECT steps_used FROM agent_runs WHERE id = runs_fts.rowid) AS steps_used,
            (SELECT created_at FROM agent_runs WHERE id = runs_fts.rowid) AS created_at
     FROM runs_fts WHERE runs_fts MATCH ? ORDER BY rank LIMIT ?`,
  ).all(match, capped) as RunHit[];
}
