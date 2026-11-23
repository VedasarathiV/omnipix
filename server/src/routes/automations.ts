import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  createAutomation,
  deleteAutomation,
  getAutomation,
  listAutomations,
  runAutomationOnce,
  updateAutomation,
} from '../services/automations.js';
import { refreshAutomationWatchers } from '../services/automation-watch.js';

export const automationsRouter = Router();

const automationSchema = z.object({
  name: z.string().trim().min(1).max(64),
  goal: z.string().trim().min(1).max(8000),
  schedule: z.string().trim().max(64).optional(),
  watch: z.array(z.string().trim().min(1).max(1024)).max(10).optional(),
  model: z.string().trim().min(1).max(200).optional(),
  enabled: z.boolean().optional(),
});

automationsRouter.get('/', (_req: Request, res: Response) => {
  res.json({ automations: listAutomations() });
});

automationsRouter.post('/', (req: Request, res: Response) => {
  const parsed = automationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.issues.map(e => e.message).join(', ') } });
    return;
  }
  try {
    const id = createAutomation(parsed.data);
    refreshAutomationWatchers();
    res.status(201).json({ automation: getAutomation(id) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('already exists') ? 409 : 400;
    res.status(status).json({ error: { message } });
  }
});

automationsRouter.get('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { message: 'Invalid automation ID' } });
    return;
  }
  const automation = getAutomation(id);
  if (!automation) {
    res.status(404).json({ error: { message: 'Automation not found' } });
    return;
  }
  res.json({ automation });
});

automationsRouter.patch('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { message: 'Invalid automation ID' } });
    return;
  }
  const parsed = automationSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.issues.map(e => e.message).join(', ') } });
    return;
  }
  try {
    updateAutomation(id, parsed.data);
    refreshAutomationWatchers();
    res.json({ automation: getAutomation(id) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message === 'Automation not found' ? 404 : 400;
    res.status(status).json({ error: { message } });
  }
});

automationsRouter.delete('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { message: 'Invalid automation ID' } });
    return;
  }
  if (!deleteAutomation(id)) {
    res.status(404).json({ error: { message: 'Automation not found' } });
    return;
  }
  refreshAutomationWatchers();
  res.json({ deleted: id });
});

// Manual run: fires now and, once it lands, reviews the automation so the
// recurring schedule may start firing.
automationsRouter.post('/:id/run', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { message: 'Invalid automation ID' } });
    return;
  }
  try {
    const runId = runAutomationOnce(id);
    res.status(202).json({ run_id: runId, automation: getAutomation(id) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message === 'Automation not found' ? 404 : message.includes('live run') ? 409 : 400;
    res.status(status).json({ error: { message } });
  }
});
