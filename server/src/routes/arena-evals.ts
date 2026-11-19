import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { runModelCall } from '../services/fusion.js';
import { routePinnedModel, pinnedModelFitsRequestSize, resolveFusionCandidate, routingReserveTokens } from '../services/router.js';
import { estimateInputTokens, messageHasImage } from '../lib/content.js';
import { gradeOutput, gradeShellChecks, CHECK_TYPES, type EvalCheck } from '../services/eval-judge.js';
import { getVerifyRecipe, listVerifyRecipes } from '../services/verify-recipes.js';
import {
  AGENT_MAX_STEPS,
  AGENT_MAX_TOOLS,
  AGENT_TOOL_NAMES,
  createAgentRun,
  executeAgentRun,
} from '../services/agent-runtime.js';
import { createSession } from '../services/agent-sessions.js';
import { resolveInRoot, runWorkspace } from '../lib/workspace.js';
import { unknownMcpTools, unknownNames } from './agent-runs.js';
import type { ChatMessage } from '@omnipix/shared/types.js';

export const evalRouter = Router();

const EVAL_TAG = 'eval';
const EVAL_MAX_MODELS = 6;
const EVAL_MAX_ITEMS = 50;
const EVAL_ATTEMPTS = 2;

const checkSchema = z.object({
  type: z.enum(CHECK_TYPES as unknown as [string, ...string[]]),
  value: z.string().max(2000).optional(),
});

// Coding-task items: the prompt runs as an agent in a seeded workspace and
// shell checks grade the result (SWE-bench shape). String checks still apply
// to the final answer, so an item can mix both.
const agentItemSchema = z.object({
  tools: z.array(z.string().trim().min(1).max(128)).max(AGENT_MAX_TOOLS).optional(),
  maxSteps: z.number().int().min(1).max(AGENT_MAX_STEPS).optional(),
  files: z.record(z.string().trim().min(1).max(200), z.string().max(20000)).optional(),
}).refine(
  agent => {
    if (!agent.files) return true;
    const entries = Object.entries(agent.files);
    if (entries.length > 50) return false;
    return entries.reduce((n, [, content]) => n + content.length, 0) <= 500_000;
  },
  { message: 'At most 50 seed files totaling 500KB.' },
);

const itemSchema = z.object({
  id: z.string().trim().min(1).max(80),
  prompt: z.string().trim().min(1).max(8000),
  checks: z.array(checkSchema).min(1).max(8),
  recipes: z.array(z.string().trim().min(1).max(40)).max(4).optional(),
  agent: agentItemSchema.optional(),
});

const suiteSchema = z.object({
  name: z.string().trim().min(1).max(60).regex(/^[a-z0-9][a-z0-9-]*$/, 'Lowercase letters, digits, and dashes.'),
  description: z.string().max(500).default(''),
  items: z.array(itemSchema).min(1).max(EVAL_MAX_ITEMS),
});

const evalRunSchema = z.object({
  suite: z.string().trim().min(1),
  models: z.array(z.string().trim().min(1).max(200)).min(1).max(EVAL_MAX_MODELS),
  max_tokens: z.number().int().min(1).max(128000).optional(),
  temperature: z.number().min(0).max(2).optional(),
});

interface SuiteRow {
  id: number;
  name: string;
  description: string;
  items_json: string;
  builtin: number;
  created_at: string;
}

function toSuite(row: SuiteRow) {
  return { ...row, items: JSON.parse(row.items_json) as unknown[] };
}

interface SuiteItem {
  id: string;
  prompt: string;
  checks: EvalCheck[];
  agent?: { tools?: string[]; maxSteps?: number; files?: Record<string, string> };
}

/** Expand recipe names into shell checks. Returns an error message when a
 * recipe is unknown, otherwise the items with recipes resolved. */
function expandRecipes(items: Array<{ id: string; checks: Array<{ type: string; value?: string }>; recipes?: string[] }>): string | null {
  for (const item of items) {
    if (!item.recipes?.length) continue;
    for (const name of item.recipes) {
      const recipe = getVerifyRecipe(name);
      if (!recipe) return `Item '${item.id}': unknown verify recipe '${name}'.`;
      if (item.checks.length + recipe.commands.length > 16) {
        return `Item '${item.id}': recipes push checks past the 16-check cap.`;
      }
      for (const command of recipe.commands) {
        item.checks.push({ type: 'shell', value: command });
      }
    }
    delete item.recipes;
  }
  return null;
}

/** Cross-field item validation the zod schema can't express. Null when valid. */
function validateItems(items: Array<{
  id: string;
  checks: Array<{ type: string; value?: string }>;
  agent?: { tools?: string[]; maxSteps?: number; files?: Record<string, string> };
}>): string | null {
  for (const item of items) {
    const shells = item.checks.filter(c => c.type === 'shell');
    if (shells.length && !item.agent) {
      return `Item '${item.id}': shell checks need an agent block with a workspace.`;
    }
    for (const shell of shells) {
      if (!shell.value?.trim()) return `Item '${item.id}': shell checks need a command.`;
    }
    if (!item.agent) continue;
    if (item.agent.tools?.includes('delegate')) {
      return `Item '${item.id}': delegate is not allowed in eval agents — unattended children cannot park for approval.`;
    }
    const native = item.agent.tools?.filter(t => !t.startsWith('mcp:'));
    const bad = unknownNames(native, new Set(AGENT_TOOL_NAMES), 'tool(s)') ?? unknownMcpTools(item.agent.tools);
    if (bad) return `Item '${item.id}': ${bad}`;
    for (const rel of Object.keys(item.agent.files ?? {})) {
      if (path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) {
        return `Item '${item.id}': seed file escapes the workspace: ${rel}`;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------- suites

evalRouter.get('/verify-recipes', (_req: Request, res: Response) => {
  res.json({ recipes: listVerifyRecipes() });
});

evalRouter.get('/suites', (_req: Request, res: Response) => {
  const rows = getDb().prepare('SELECT * FROM eval_suites ORDER BY builtin DESC, name ASC').all() as SuiteRow[];
  res.json({ suites: rows.map(toSuite) });
});

evalRouter.post('/suites', (req: Request, res: Response) => {
  const parsed = suiteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.issues.map(e => e.message).join(', ') } });
    return;
  }
  const { name, description, items } = parsed.data;
  const ids = items.map(item => item.id);
  if (new Set(ids).size !== ids.length) {
    res.status(400).json({ error: { message: 'Duplicate item ids in suite.' } });
    return;
  }
  const badRecipe = expandRecipes(items);
  if (badRecipe) {
    res.status(400).json({ error: { message: badRecipe } });
    return;
  }
  const invalid = validateItems(items);
  if (invalid) {
    res.status(400).json({ error: { message: invalid } });
    return;
  }
  try {
    getDb().prepare(
      'INSERT INTO eval_suites (name, description, items_json, builtin) VALUES (?, ?, ?, 0)',
    ).run(name, description, JSON.stringify(items));
  } catch {
    res.status(409).json({ error: { message: `Suite '${name}' already exists.` } });
    return;
  }
  const row = getDb().prepare('SELECT * FROM eval_suites WHERE name = ?').get(name) as SuiteRow;
  res.status(201).json({ suite: toSuite(row) });
});

evalRouter.patch('/suites/:name', (req: Request, res: Response) => {
  const parsed = suiteSchema.partial().omit({ name: true }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.issues.map(e => e.message).join(', ') } });
    return;
  }
  const row = getDb().prepare('SELECT * FROM eval_suites WHERE name = ?').get(req.params.name) as SuiteRow | undefined;
  if (!row) {
    res.status(404).json({ error: { message: 'Suite not found' } });
    return;
  }
  const description = parsed.data.description ?? row.description;
  const items = parsed.data.items ?? JSON.parse(row.items_json);
  if (parsed.data.items) {
    const ids = items.map((item: { id: string }) => item.id);
    if (new Set(ids).size !== ids.length) {
      res.status(400).json({ error: { message: 'Duplicate item ids in suite.' } });
      return;
    }
    const badRecipe = expandRecipes(items);
    if (badRecipe) {
      res.status(400).json({ error: { message: badRecipe } });
      return;
    }
    const invalid = validateItems(items);
    if (invalid) {
      res.status(400).json({ error: { message: invalid } });
      return;
    }
  }
  getDb().prepare('UPDATE eval_suites SET description = ?, items_json = ? WHERE name = ?')
    .run(description, JSON.stringify(items), req.params.name);
  const updated = getDb().prepare('SELECT * FROM eval_suites WHERE name = ?').get(req.params.name) as SuiteRow;
  res.json({ suite: toSuite(updated) });
});

evalRouter.delete('/suites/:name', (req: Request, res: Response) => {
  const row = getDb().prepare('SELECT builtin FROM eval_suites WHERE name = ?').get(req.params.name) as { builtin: number } | undefined;
  if (!row) {
    res.status(404).json({ error: { message: 'Suite not found' } });
    return;
  }
  if (row.builtin) {
    res.status(403).json({ error: { message: 'Built-in suites cannot be deleted. Disable the models instead of removing the suite.' } });
    return;
  }
  getDb().prepare('DELETE FROM eval_suites WHERE name = ?').run(req.params.name);
  res.json({ deleted: req.params.name });
});

// ---------------------------------------------------------------- runs

interface ModelResult {
  model: string;
  displayName: string;
  platform: string;
  passed: number;
  total: number;
  items: Array<{
    id: string;
    pass: boolean;
    text?: string;
    error?: string;
    latencyMs: number;
    checks: Array<{ type: string; pass: boolean; detail: string }>;
    agentRunId?: number;
    agentStatus?: string;
  }>;
}

async function executeEvalRun(
  runId: number,
  suiteName: string,
  models: string[],
  maxTokens?: number,
  temperature?: number,
): Promise<void> {
  const db = getDb();
  const fail = (message: string) => {
    db.prepare("UPDATE eval_runs SET status = 'error', error = ?, finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?")
      .run(message, runId);
  };
  try {
    const suite = db.prepare('SELECT * FROM eval_suites WHERE name = ?').get(suiteName) as SuiteRow | undefined;
    if (!suite) {
      fail(`Suite '${suiteName}' no longer exists.`);
      return;
    }
    const items = JSON.parse(suite.items_json) as SuiteItem[];
    // One session threads every agent item of this eval together, so the
    // dashboard history reads as a single benchmark thread.
    let evalSessionId: number | null = null;
    const sessionId = (): number => {
      evalSessionId ??= createSession(`eval ${suiteName} #${runId}`);
      return evalSessionId;
    };
    const resolved: { id: number; modelId: string; displayName: string; platform: string; supportsVision: boolean }[] = [];
    for (const modelId of [...new Set(models)]) {
      const candidate = resolveFusionCandidate(modelId, { allowGroupFallback: false });
      if (!candidate) {
        fail(`Unknown or disabled model: ${modelId}.`);
        return;
      }
      resolved.push({
        id: candidate.modelDbId, modelId: candidate.modelId, displayName: candidate.displayName,
        platform: candidate.platform, supportsVision: candidate.supportsVision === 1,
      });
    }

    const runModel = async (entry: (typeof resolved)[number]): Promise<ModelResult> => {
      const result: ModelResult = {
        model: entry.modelId, displayName: entry.displayName, platform: entry.platform,
        passed: 0, total: items.length, items: [],
      };
      // Items run in sequence per model so one eval cannot stampede a
      // provider; models run in parallel with per-model isolation.
      for (const item of items) {
        const startedAt = Date.now();
        // Coding-task item: run the prompt as an unattended agent in a seeded
        // workspace, then grade shell checks in that workspace (plus any
        // string checks on the final answer). Eval-level max_tokens and
        // temperature don't apply here — the agent loop has its own budgets.
        if (item.agent) {
          try {
            const tools = item.agent.tools ?? AGENT_TOOL_NAMES.filter(t => t !== 'delegate');
            const agentRunId = createAgentRun({
              goal: item.prompt, model: entry.modelId, tools, skills: [],
              maxSteps: item.agent.maxSteps ?? 12, sessionId: sessionId(), autoApprove: true,
            });
            const ws = runWorkspace(agentRunId);
            for (const [rel, content] of Object.entries(item.agent.files ?? {})) {
              const abs = resolveInRoot(ws, rel);
              fs.mkdirSync(path.dirname(abs), { recursive: true });
              fs.writeFileSync(abs, content);
            }
            const agent = await executeAgentRun(agentRunId, {
              goal: item.prompt, model: entry.modelId, tools, skills: [],
              maxSteps: item.agent.maxSteps ?? 12, autoApprove: true,
            });
            const text = agent.final_answer ?? '';
            const stringChecks = item.checks.filter(c => c.type !== 'shell');
            const shellChecks = item.checks.filter(c => c.type === 'shell');
            const graded = gradeOutput(text, stringChecks);
            const shelled = await gradeShellChecks(ws, shellChecks);
            // Merge back into suite order so the detail list reads as authored.
            const merged: typeof graded.results = [];
            let si = 0;
            let hi = 0;
            for (const check of item.checks) {
              merged.push(check.type === 'shell' ? shelled.results[hi++] : graded.results[si++]);
            }
            const pass = graded.pass && shelled.pass;
            if (pass) result.passed += 1;
            result.items.push({
              id: item.id, pass, text: text.slice(0, 4000),
              latencyMs: Date.now() - startedAt,
              checks: merged,
              agentRunId, agentStatus: agent.status,
            });
          } catch (err) {
            result.items.push({
              id: item.id, pass: false,
              error: err instanceof Error ? err.message : String(err),
              latencyMs: Date.now() - startedAt, checks: [],
            });
          }
          continue;
        }
        const messages = [{ role: 'user', content: item.prompt }] as ChatMessage[];
        const estimatedTokens = estimateInputTokens(messages) + routingReserveTokens(maxTokens);
        if (messageHasImage(messages) && !entry.supportsVision) {
          result.items.push({ id: item.id, pass: false, error: 'Model does not support image input.', latencyMs: Date.now() - startedAt, checks: [] });
          continue;
        }
        if (!pinnedModelFitsRequestSize(entry.id, estimatedTokens)) {
          result.items.push({ id: item.id, pass: false, error: 'Request exceeds context window or TPM ceiling.', latencyMs: Date.now() - startedAt, checks: [] });
          continue;
        }
        try {
          const outcome = await runModelCall(
            (skipKeys) => routePinnedModel(entry.id, estimatedTokens, skipKeys),
            messages,
            { max_tokens: maxTokens, temperature },
            estimatedTokens,
            EVAL_ATTEMPTS,
            () => 'rate_limited',
            EVAL_TAG,
          );
          if (!outcome.ok) {
            result.items.push({ id: item.id, pass: false, error: outcome.error ?? 'Model unavailable.', latencyMs: Date.now() - startedAt, checks: [] });
            continue;
          }
          const text = outcome.text ?? '';
          const graded = gradeOutput(text, item.checks);
          if (graded.pass) result.passed += 1;
          result.items.push({ id: item.id, pass: graded.pass, text, latencyMs: Date.now() - startedAt, checks: graded.results });
        } catch (err) {
          result.items.push({ id: item.id, pass: false, error: err instanceof Error ? err.message : String(err), latencyMs: Date.now() - startedAt, checks: [] });
        }
      }
      return result;
    };

    const results = await Promise.all(resolved.map(runModel));
    db.prepare("UPDATE eval_runs SET status = 'done', results_json = ?, finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?")
      .run(JSON.stringify(results), runId);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

evalRouter.post('/evals', (req: Request, res: Response) => {
  const parsed = evalRunSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.issues.map(e => e.message).join(', ') } });
    return;
  }
  const { suite, models, max_tokens, temperature } = parsed.data;
  const row = getDb().prepare('SELECT id FROM eval_suites WHERE name = ?').get(suite) as { id: number } | undefined;
  if (!row) {
    res.status(400).json({ error: { message: `Unknown suite: ${suite}.` } });
    return;
  }
  if (new Set(models).size !== models.length) {
    res.status(400).json({ error: { message: 'Duplicate model ids in eval request.' } });
    return;
  }
  for (const modelId of models) {
    if (!resolveFusionCandidate(modelId, { allowGroupFallback: false })) {
      res.status(400).json({ error: { message: `Unknown or disabled model: ${modelId}. Call /v1/models for the available list.` } });
      return;
    }
  }
  const created = getDb().prepare(
    'INSERT INTO eval_runs (suite_id, models_json) VALUES (?, ?) RETURNING id',
  ).get(row.id, JSON.stringify(models)) as { id: number };
  void executeEvalRun(created.id, suite, models, max_tokens, temperature).catch(() => {
    // executeEvalRun records its own failures on the row; this only guards
    // against a throw in the failure path itself.
  });
  res.status(202).json(getEvalRun(created.id));
});

interface EvalRunRow {
  id: number;
  suite_id: number;
  models_json: string;
  status: string;
  results_json: string;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

function getEvalRun(id: number) {
  const row = getDb().prepare(
    `SELECT r.*, s.name AS suite FROM eval_runs r JOIN eval_suites s ON s.id = r.suite_id WHERE r.id = ?`,
  ).get(id) as (EvalRunRow & { suite: string }) | undefined;
  if (!row) return null;
  return {
    id: row.id,
    suite: row.suite,
    models: JSON.parse(row.models_json) as string[],
    status: row.status,
    error: row.error,
    results: JSON.parse(row.results_json) as ModelResult[],
    created_at: row.created_at,
    finished_at: row.finished_at,
  };
}

evalRouter.get('/evals', (req: Request, res: Response) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const rows = getDb().prepare(
    `SELECT r.*, s.name AS suite FROM eval_runs r JOIN eval_suites s ON s.id = r.suite_id ORDER BY r.id DESC LIMIT ?`,
  ).all(limit) as (EvalRunRow & { suite: string })[];
  res.json({
    evals: rows.map(row => ({
      id: row.id,
      suite: row.suite,
      models: JSON.parse(row.models_json) as string[],
      status: row.status,
      error: row.error,
      results: JSON.parse(row.results_json) as ModelResult[],
      created_at: row.created_at,
      finished_at: row.finished_at,
    })),
  });
});

evalRouter.get('/evals/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { message: 'Invalid eval ID' } });
    return;
  }
  const run = getEvalRun(id);
  if (!run) {
    res.status(404).json({ error: { message: 'Eval run not found' } });
    return;
  }
  res.json(run);
});

// ---------------------------------------------------------------- scorecards

evalRouter.get('/scorecards', (_req: Request, res: Response) => {
  const rows = getDb().prepare(
    `SELECT r.results_json AS resultsJson, s.name AS suite, r.finished_at AS finishedAt
       FROM eval_runs r JOIN eval_suites s ON s.id = r.suite_id
      WHERE r.status = 'done' ORDER BY r.id DESC LIMIT 200`,
  ).all() as { resultsJson: string; suite: string; finishedAt: string }[];
  const cards = new Map<string, {
    model: string; displayName: string; platform: string;
    runs: number; passed: number; total: number;
    suites: Record<string, { runs: number; passed: number; total: number }>;
    lastRunAt: string;
  }>();
  for (const row of rows) {
    let results: ModelResult[];
    try {
      results = JSON.parse(row.resultsJson) as ModelResult[];
    } catch { continue; }
    for (const result of results) {
      let card = cards.get(result.model);
      if (!card) {
        card = {
          model: result.model, displayName: result.displayName, platform: result.platform,
          runs: 0, passed: 0, total: 0, suites: {}, lastRunAt: row.finishedAt,
        };
        cards.set(result.model, card);
      }
      card.runs += 1;
      card.passed += result.passed;
      card.total += result.total;
      const entry = card.suites[row.suite] ?? { runs: 0, passed: 0, total: 0 };
      entry.runs += 1;
      entry.passed += result.passed;
      entry.total += result.total;
      card.suites[row.suite] = entry;
    }
  }
  res.json({
    scorecards: [...cards.values()].map(card => ({
      ...card,
      passRate: card.total === 0 ? 0 : Math.round((card.passed / card.total) * 1000) / 1000,
    })).sort((a, b) => b.passRate - a.passRate || a.model.localeCompare(b.model)),
  });
});
