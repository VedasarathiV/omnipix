import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  createGroup,
  deleteGroup,
  driveGroup,
  getGroup,
  listGroups,
  planGroupTasks,
  resumeGroup,
  stopGroup,
  substituteInputs,
  validateTaskGraph,
  type TaskInput,
} from '../services/agent-orchestrator.js';
import { blackboardWrite } from '../lib/agent-coordination.js';
import { listRunbooks, resolveRunbook } from '../services/runbooks.js';

export const agentGroupsRouter = Router();

const taskSchema = z.object({
  name: z.string().trim().min(1).max(80),
  role: z.string().trim().min(1).max(32).optional(),
  goal: z.string().trim().min(1).max(8000),
  tools: z.array(z.string().trim().min(1).max(128)).max(32).optional(),
  dependsOn: z.array(z.number().int().min(0)).max(8).optional(),
  maxAttempts: z.number().int().min(1).max(5).optional(),
  expectedOutput: z.string().trim().min(1).max(2000).optional(),
  inputs: z.array(z.object({
    name: z.string().trim().min(1).max(64),
    from: z.number().int().min(0),
  })).max(8).optional(),
  guardrail: z.object({
    type: z.enum(['llm_judge', 'shell']),
    prompt: z.string().trim().min(1).max(2000).optional(),
    command: z.string().trim().min(1).max(2000).optional(),
  }).optional(),
  outputJson: z.boolean().optional(),
  outputFile: z.string().trim().min(1).max(200).optional(),
});

const createGroupSchema = z.object({
  goal: z.string().trim().min(1).max(8000),
  tasks: z.array(taskSchema).min(1).max(8).optional(),
  auto: z.boolean().optional(),
  preset: z.string().trim().min(1).max(64).optional(),
  inputs: z.record(z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_]+$/), z.string().trim().min(1).max(2000)).optional(),
  mode: z.enum(['dag', 'hierarchical']).optional(),
  model: z.string().trim().min(1).max(200).optional(),
  budgetTokens: z.number().int().min(1000).max(10_000_000).optional(),
});

agentGroupsRouter.post('/groups', async (req: Request, res: Response) => {
  const parsed = createGroupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.issues.map(e => e.message).join(', ') } });
    return;
  }
  const { goal: rawGoal, tasks, auto, preset, inputs, mode, model, budgetTokens } = parsed.data;
  let goal = rawGoal;
  const sources = [tasks?.length ? 1 : 0, auto ? 1 : 0, preset ? 1 : 0].reduce((a, b) => a + b, 0);
  if (sources > 1) {
    res.status(400).json({ error: { message: 'Send only one of tasks, auto, or preset.' } });
    return;
  }
  let resolved: TaskInput[];
  if (tasks?.length) {
    const graphError = validateTaskGraph(tasks);
    if (graphError) {
      res.status(400).json({ error: { message: graphError } });
      return;
    }
    resolved = tasks;
  } else if (preset) {
    const expanded = resolveRunbook(preset, goal);
    if (!expanded) {
      res.status(400).json({ error: { message: `Unknown preset: ${preset}. Known: ${listRunbooks().map(r => r.name).join(', ')}` } });
      return;
    }
    resolved = expanded;
  } else if (auto) {
    try {
      resolved = await planGroupTasks(goal, model);
    } catch (err) {
      res.status(502).json({ error: { message: err instanceof Error ? err.message : String(err) } });
      return;
    }
  } else if (mode === 'hierarchical') {
    // The manager plans live; seed tasks are optional, not required.
    resolved = [];
  } else {
    res.status(400).json({ error: { message: 'Send tasks, auto: true, or preset.' } });
    return;
  }
  if (inputs) {
    const filled = { goal, tasks: resolved };
    const inputError = substituteInputs(goal, resolved, inputs, filled);
    if (inputError) {
      res.status(400).json({ error: { message: inputError } });
      return;
    }
    goal = filled.goal;
    resolved = filled.tasks;
  }
  const id = createGroup(goal, resolved, budgetTokens, mode);
  // Fire and forget like runs: the driver persists everything it does.
  void driveGroup(id, model).catch(() => {
    // driveLoop records its own terminal state; this guards the guard.
  });
  res.status(202).json(getGroup(id));
});

agentGroupsRouter.get('/runbooks', (_req: Request, res: Response) => {
  res.json({ runbooks: listRunbooks() });
});

agentGroupsRouter.get('/groups', (req: Request, res: Response) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  res.json({ groups: listGroups(limit) });
});

agentGroupsRouter.get('/groups/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { message: 'Invalid group ID' } });
    return;
  }
  const group = getGroup(id);
  if (!group) {
    res.status(404).json({ error: { message: 'Group not found' } });
    return;
  }
  res.json(group);
});

agentGroupsRouter.post('/groups/:id/stop', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { message: 'Invalid group ID' } });
    return;
  }
  if (!getGroup(id)) {
    res.status(404).json({ error: { message: 'Group not found' } });
    return;
  }
  stopGroup(id);
  res.json(getGroup(id));
});

agentGroupsRouter.post('/groups/:id/resume', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { message: 'Invalid group ID' } });
    return;
  }
  if (!getGroup(id)) {
    res.status(404).json({ error: { message: 'Group not found' } });
    return;
  }
  try {
    const group = resumeGroup(id);
    // Fire and forget like create: the driver persists everything it does.
    void driveGroup(id).catch(() => {
      // driveLoop records its own terminal state; this guards the guard.
    });
    res.status(202).json(group);
  } catch (err) {
    res.status(409).json({ error: { message: err instanceof Error ? err.message : String(err) } });
  }
});

agentGroupsRouter.delete('/groups/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { message: 'Invalid group ID' } });
    return;
  }
  if (!deleteGroup(id)) {
    res.status(404).json({ error: { message: 'Group not found' } });
    return;
  }
  res.json({ deleted: id });
});

const noteSchema = z.object({
  key: z.string().trim().min(1).max(128),
  value: z.string().max(4000),
});

// Operator steering: pin a note to the blackboard mid-run. writerTaskId is
// null — the team can tell it came from the human.
agentGroupsRouter.post('/groups/:id/blackboard', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { message: 'Invalid group ID' } });
    return;
  }
  if (!getGroup(id)) {
    res.status(404).json({ error: { message: 'Group not found' } });
    return;
  }
  const parsed = noteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: 'Send {"key": ..., "value": ...}' } });
    return;
  }
  blackboardWrite(id, null, parsed.data.key, parsed.data.value);
  res.status(201).json(getGroup(id));
});
