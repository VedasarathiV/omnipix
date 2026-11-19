import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import {
  AGENT_MAX_COMPACTIONS,
  AGENT_MAX_STEPS,
  AGENT_MAX_TOOLS,
  AGENT_TOOL_NAMES,
  appendStep,
  assertResumable,
  createAgentRun,
  executeAgentRun,
  getAgentRun,
  listAgentRuns,
  listSkills,
  parseSlashSkills,
  resumeAgentRun,
  stopAgentRun,
  subscribeRun,
} from '../services/agent-runtime.js';
import { createSession, getSession, touchSession } from '../services/agent-sessions.js';
import { createCheckpoint, getCheckpoint, listCheckpoints, restoreCheckpoint } from '../services/checkpoints.js';
import { listProposals, resolveProposal, searchRuns } from '../services/learning-loop.js';
import { cloneRepoAtRef, diffStat, fetchRefInto, runWorkspace } from '../lib/workspace.js';

export const agentRunsRouter = Router();

const createRunSchema = z.object({
  goal: z.string().trim().min(1).max(8000),
  model: z.string().trim().min(1).max(200).optional(),
  tools: z.array(z.string().trim().min(1).max(128)).max(AGENT_MAX_TOOLS).optional(),
  skills: z.array(z.string().trim().min(1).max(64)).max(10).optional(),
  maxSteps: z.number().int().min(1).max(AGENT_MAX_STEPS).optional(),
  maxTokens: z.number().int().min(100).max(10_000_000).optional(),
  sessionId: z.number().int().positive().optional(),
  projectKey: z.string().trim().min(1).max(128).optional(),
  planMode: z.boolean().optional(),
  compactions: z.number().int().min(0).max(AGENT_MAX_COMPACTIONS).optional(),
});

// Unknown tool/skill names fail the whole request so a typo can't silently
// shrink the run's capabilities.
export function unknownNames(wanted: string[] | undefined, known: Set<string>, kind: string): string | null {
  if (!wanted?.length) return null;
  const unknown = [...new Set(wanted)].filter(n => !known.has(n));
  return unknown.length ? `Unknown ${kind}: ${unknown.join(', ')}.` : null;
}

// MCP tools validate by shape here (`mcp:<server>:<tool>` against a
// registered, enabled server); the tool itself must exist at run start,
// when live schemas resolve.
export function unknownMcpTools(wanted: string[] | undefined): string | null {
  if (!wanted?.length) return null;
  const namespaced = [...new Set(wanted)].filter(n => n.startsWith('mcp:'));
  if (!namespaced.length) return null;
  const bad: string[] = [];
  for (const name of namespaced) {
    const rest = name.slice('mcp:'.length);
    const sep = rest.indexOf(':');
    if (sep <= 0 || sep === rest.length - 1) {
      bad.push(name);
      continue;
    }
    const server = getDb().prepare('SELECT enabled FROM mcp_servers WHERE name = ?').get(rest.slice(0, sep)) as { enabled: number } | undefined;
    if (!server) bad.push(`${name} (unknown server)`);
    else if (!server.enabled) bad.push(`${name} (server disabled)`);
  }
  return bad.length ? `Unknown tool(s): ${bad.join(', ')}.` : null;
}

agentRunsRouter.post('/runs', (req: Request, res: Response) => {
  // Slash invocation first: leading /names attach skills, and the stored
  // goal is the stripped text (the trace reads clean; skills_json keeps
  // the record of what was invoked).
  const rawGoal = typeof req.body?.goal === 'string' ? req.body.goal : '';
  const { skills: slashSkills, goal: strippedGoal } = parseSlashSkills(rawGoal);
  if (slashSkills.length && !strippedGoal.trim()) {
    res.status(400).json({ error: { message: 'Goal text is required after /commands.' } });
    return;
  }
  const parsed = createRunSchema.safeParse({ ...req.body, goal: strippedGoal });
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.issues.map(e => e.message).join(', ') } });
    return;
  }
  const { goal, model, tools, maxSteps, maxTokens, sessionId, projectKey, planMode, compactions } = parsed.data;
  const skills = [...new Set([...(parsed.data.skills ?? []), ...slashSkills])];
  if (sessionId !== undefined && !getSession(sessionId)) {
    res.status(400).json({ error: { message: `Unknown session: ${sessionId}.` } });
    return;
  }
  const nativeTools = tools?.filter(t => !t.startsWith('mcp:'));
  const badTools = unknownNames(nativeTools, new Set(AGENT_TOOL_NAMES), 'tool(s)') ?? unknownMcpTools(tools);
  if (badTools) {
    res.status(400).json({ error: { message: `${badTools} Known: ${AGENT_TOOL_NAMES.join(', ')}, mcp:<server>:<tool>.` } });
    return;
  }
  const skillNames = new Set(listSkills(true).map(s => s.name));
  const badSkills = unknownNames(skills, skillNames, 'skill(s)');
  if (badSkills) {
    res.status(400).json({ error: { message: `${badSkills} Known: ${[...skillNames].join(', ') || 'none'}.` } });
    return;
  }
  if (model && model !== 'auto') {
    const row = getDb().prepare('SELECT 1 FROM models WHERE model_id = ? AND enabled = 1').get(model);
    if (!row) {
      res.status(400).json({ error: { message: `Unknown or disabled model: ${model}. Call /v1/models for the available list.` } });
      return;
    }
  }
  // Every run belongs to a session so it is continuable from any surface;
  // callers that pass none get one titled from the goal.
  const resolvedSessionId = sessionId ?? createSession(goal);
  const id = createAgentRun({ goal, model, tools, skills, maxSteps, sessionId: resolvedSessionId, projectKey, planMode });
  touchSession(resolvedSessionId);
  // Fire and forget: the loop persists every step, so polling and SSE both
  // work; a synchronous throw here can only come from setup, already validated.
  void executeAgentRun(id, { goal, model, tools, skills, maxSteps, maxTokens, projectKey, planMode, compactions }).catch((err: unknown) => {
    getDb().prepare("UPDATE agent_runs SET status = 'error', error = ?, finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND status IN ('running', 'awaiting_approval')")
      .run(err instanceof Error ? err.message : String(err), id);
  });
  res.status(202).json(getAgentRun(id));
});

const reviewSchema = z.object({
  repo: z.string().trim().min(1).max(500),
  base: z.string().trim().min(1).max(120),
  head: z.string().trim().min(1).max(120).optional(),
  instructions: z.string().trim().max(2000).optional(),
  model: z.string().trim().min(1).max(200).optional(),
  maxSteps: z.number().int().min(1).max(AGENT_MAX_STEPS).optional(),
});

// PR review: clone the repo at head into a run workspace, then launch a
// read-only review agent over base...HEAD. The GitHub Action polls the run
// and posts the verdict. Read-only tools only — a reviewer never writes.
const REVIEW_TOOLS = ['read_file', 'grep_search', 'git_status', 'git_diff', 'git_log', 'memory_read'];

agentRunsRouter.post('/review', async (req: Request, res: Response) => {
  const parsed = reviewSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.issues.map(e => e.message).join(', ') } });
    return;
  }
  const { repo, base, head, instructions, model, maxSteps } = parsed.data;
  if (!/^https:\/\/.+/.test(repo)) {
    res.status(400).json({ error: { message: 'repo must be an https URL' } });
    return;
  }
  const goal = [
    `Review pull request ${base}...${head ?? 'HEAD'} of ${repo} for correctness, security, and tests.`,
    'Read the changed files with the read tools; check for bugs, injection risks, and missing or broken tests.',
    instructions ? `Operator focus: ${instructions}` : '',
    'Reply with ONLY: a first line "Verdict: APPROVE" or "Verdict: COMMENT" or "Verdict: REQUEST_CHANGES", then the findings list.',
  ].filter(Boolean).join('\n');
  const sessionId = createSession(`PR review: ${repo}`);
  const id = createAgentRun({ goal, model, tools: REVIEW_TOOLS, skills: ['code-reviewer'], maxSteps, sessionId, projectKey: '' });
  touchSession(sessionId);
  try {
    const ws = runWorkspace(id);
    await cloneRepoAtRef(repo, ws, head);
    await fetchRefInto(ws, base);
    const stat = await diffStat(ws, base);
    getDb().prepare('UPDATE agent_runs SET goal = ? WHERE id = ?')
      .run(`${goal}\n\nDiff stat:\n${stat}`, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    getDb().prepare("UPDATE agent_runs SET status = 'error', error = ?, finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(message, id);
    res.status(502).json({ error: { message } });
    return;
  }
  const finalGoal = (getDb().prepare('SELECT goal FROM agent_runs WHERE id = ?').get(id) as { goal: string }).goal;
  void executeAgentRun(id, { goal: finalGoal, model, tools: REVIEW_TOOLS, skills: ['code-reviewer'], maxSteps, autoApprove: true }).catch((err: unknown) => {
    getDb().prepare("UPDATE agent_runs SET status = 'error', error = ?, finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND status IN ('running', 'awaiting_approval')")
      .run(err instanceof Error ? err.message : String(err), id);
  });
  res.status(202).json(getAgentRun(id));
});

agentRunsRouter.get('/runs', (req: Request, res: Response) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const sessionId = req.query.session === undefined ? undefined : Number(req.query.session);
  if (sessionId !== undefined && (!Number.isInteger(sessionId) || sessionId <= 0)) {
    res.status(400).json({ error: { message: 'Invalid session filter' } });
    return;
  }
  res.json({ runs: listAgentRuns(limit, sessionId) });
});

agentRunsRouter.get('/runs/search', (req: Request, res: Response) => {
  const query = typeof req.query.q === 'string' ? req.query.q : '';
  if (!query.trim()) {
    res.status(400).json({ error: { message: 'Send q.' } });
    return;
  }
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
  res.json({ runs: searchRuns(query, limit) });
});

agentRunsRouter.get('/proposals', (req: Request, res: Response) => {
  const status = typeof req.query.status === 'string' ? req.query.status : 'pending';
  if (!['pending', 'accepted', 'discarded'].includes(status)) {
    res.status(400).json({ error: { message: 'status must be pending, accepted, or discarded' } });
    return;
  }
  res.json({ proposals: listProposals(status) });
});

agentRunsRouter.post('/proposals/:id/accept', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { message: 'Invalid proposal ID' } });
    return;
  }
  try {
    res.json({ proposal: resolveProposal(id, true) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = message === 'Proposal not found' ? 404 : message.startsWith('Skill already exists') ? 409 : 400;
    res.status(code).json({ error: { message } });
  }
});

agentRunsRouter.post('/proposals/:id/discard', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { message: 'Invalid proposal ID' } });
    return;
  }
  try {
    res.json({ proposal: resolveProposal(id, false) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(message === 'Proposal not found' ? 404 : 400).json({ error: { message } });
  }
});

agentRunsRouter.get('/runs/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { message: 'Invalid run ID' } });
    return;
  }
  const run = getAgentRun(id);
  if (!run) {
    res.status(404).json({ error: { message: 'Run not found' } });
    return;
  }
  res.json(run);
});

agentRunsRouter.get('/runs/:id/checkpoints', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { message: 'Invalid run ID' } });
    return;
  }
  if (!getAgentRun(id)) {
    res.status(404).json({ error: { message: 'Run not found' } });
    return;
  }
  res.json({ checkpoints: listCheckpoints(id) });
});

agentRunsRouter.post('/runs/:id/checkpoints', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { message: 'Invalid run ID' } });
    return;
  }
  const run = getAgentRun(id);
  if (!run) {
    res.status(404).json({ error: { message: 'Run not found' } });
    return;
  }
  const label = typeof req.body?.label === 'string' ? req.body.label : '';
  try {
    const checkpointId = createCheckpoint(id, label, run.steps_used);
    res.status(201).json({ checkpoint: getCheckpoint(checkpointId) });
  } catch (err) {
    res.status(400).json({ error: { message: err instanceof Error ? err.message : String(err) } });
  }
});

agentRunsRouter.post('/checkpoints/:id/restore', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { message: 'Invalid checkpoint ID' } });
    return;
  }
  const checkpoint = getCheckpoint(id);
  if (!checkpoint) {
    res.status(404).json({ error: { message: 'Checkpoint not found' } });
    return;
  }
  const run = getAgentRun(checkpoint.run_id);
  if (!run) {
    res.status(404).json({ error: { message: 'Run not found' } });
    return;
  }
  if (run.status === 'running' || run.status === 'awaiting_approval') {
    res.status(409).json({ error: { message: 'Stop the run before restoring — rewinding under a live loop would corrupt its next write.' } });
    return;
  }
  try {
    restoreCheckpoint(id);
    appendStep(checkpoint.run_id, 'restore', 'restore', { checkpoint_id: id, label: checkpoint.label });
    res.json({ restored: id, run: getAgentRun(checkpoint.run_id) });
  } catch (err) {
    res.status(400).json({ error: { message: err instanceof Error ? err.message : String(err) } });
  }
});

agentRunsRouter.post('/runs/:id/stop', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { message: 'Invalid run ID' } });
    return;
  }
  const run = getAgentRun(id);
  if (!run) {
    res.status(404).json({ error: { message: 'Run not found' } });
    return;
  }
  stopAgentRun(id);
  res.json(getAgentRun(id));
});

const resumeSchema = z.object({
  maxSteps: z.number().int().min(1).max(AGENT_MAX_STEPS).optional(),
});

// Resume a dead run: the step log replays into context and the loop
// continues with a fresh turn budget. Only errored/stopped runs qualify;
// live runs keep their driver and parked runs keep their approval.
agentRunsRouter.post('/runs/:id/resume', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { message: 'Invalid run ID' } });
    return;
  }
  const parsed = resumeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.issues.map(e => e.message).join(', ') } });
    return;
  }
  const run = getAgentRun(id);
  if (!run) {
    res.status(404).json({ error: { message: 'Run not found' } });
    return;
  }
  try {
    assertResumable(id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('not found') ? 404 : 400;
    res.status(status).json({ error: { message } });
    return;
  }
  void resumeAgentRun(id, { maxSteps: parsed.data.maxSteps }).catch(() => {
    // The loop lands its own terminal state; unhandled rejections crash.
  });
  res.status(202).json(getAgentRun(id));
});

// Live trace: replays persisted steps, then streams new ones until done.
agentRunsRouter.get('/runs/:id/events', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { message: 'Invalid run ID' } });
    return;
  }
  const run = getAgentRun(id);
  if (!run) {
    res.status(404).json({ error: { message: 'Run not found' } });
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (event: unknown) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  const seen = new Set<number>();
  for (const step of run.steps) {
    seen.add(step.seq);
    send({ type: 'step', step });
  }
  // awaiting_approval keeps the stream open: the run resumes on decide and
  // steps continue flowing over this same connection.
  if (run.status !== 'running' && run.status !== 'awaiting_approval') {
    send({ type: 'done', run: { status: run.status } });
    res.end();
    return;
  }
  const unsubscribe = subscribeRun(id, (event) => {
    if (event.type === 'step' && event.step) {
      if (seen.has(event.step.seq)) return;
      seen.add(event.step.seq);
    }
    send(event);
    if (event.type === 'done') {
      unsubscribe();
      res.end();
    }
  });
  // Steps may have landed between the SELECT above and the subscribe, and
  // the run may have finished there too — backfill, then re-check status.
  // The seen-set dedupes anything the live subscription already delivered.
  const latest = getAgentRun(id);
  if (latest) {
    for (const step of latest.steps) {
      if (seen.has(step.seq)) continue;
      seen.add(step.seq);
      send({ type: 'step', step });
    }
    if (latest.status !== 'running' && latest.status !== 'awaiting_approval') {
      unsubscribe();
      send({ type: 'done', run: { status: latest.status } });
      res.end();
      return;
    }
  }
  req.on('close', () => unsubscribe());
});
