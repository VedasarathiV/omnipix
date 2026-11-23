import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  HOOK_MAX_TIMEOUT_MS,
  HOOK_MIN_TIMEOUT_MS,
  createHook,
  deleteHook,
  getHook,
  listHooks,
  updateHook,
} from '../services/agent-hooks.js';

export const agentHooksRouter = Router();

const hookSchema = z.object({
  name: z.string().trim().min(1).max(128),
  event: z.enum(['pre_tool', 'post_tool']),
  toolFilter: z.string().trim().max(128).optional(),
  command: z.string().trim().min(1).max(2000),
  timeoutMs: z.number().int().min(HOOK_MIN_TIMEOUT_MS).max(HOOK_MAX_TIMEOUT_MS).optional(),
  enabled: z.boolean().optional(),
});

const hookPatchSchema = hookSchema.partial();

agentHooksRouter.get('/hooks', (_req: Request, res: Response) => {
  res.json({ hooks: listHooks() });
});

agentHooksRouter.post('/hooks', (req: Request, res: Response) => {
  const parsed = hookSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.issues.map(e => e.message).join(', ') } });
    return;
  }
  try {
    res.status(201).json({ hook: createHook(parsed.data) });
  } catch (err) {
    res.status(400).json({ error: { message: err instanceof Error ? err.message : String(err) } });
  }
});

agentHooksRouter.get('/hooks/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { message: 'Invalid hook ID' } });
    return;
  }
  const hook = getHook(id);
  if (!hook) {
    res.status(404).json({ error: { message: 'Hook not found' } });
    return;
  }
  res.json({ hook });
});

agentHooksRouter.patch('/hooks/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { message: 'Invalid hook ID' } });
    return;
  }
  const parsed = hookPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.issues.map(e => e.message).join(', ') } });
    return;
  }
  try {
    res.json({ hook: updateHook(id, parsed.data) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(message === 'Hook not found' ? 404 : 400).json({ error: { message } });
  }
});

agentHooksRouter.delete('/hooks/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { message: 'Invalid hook ID' } });
    return;
  }
  try {
    deleteHook(id);
    res.json({ deleted: id });
  } catch (err) {
    res.status(404).json({ error: { message: err instanceof Error ? err.message : String(err) } });
  }
});
