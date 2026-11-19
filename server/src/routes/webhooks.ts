import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { createWebhook, deleteWebhook, fireWebhookTest, listWebhooks, WEBHOOK_EVENTS } from '../services/webhooks.js';

// Outbound webhook registrations. Dashboard-gated: the URLs and secrets are
// operator config, and firing state names internal outcomes.
export const webhooksRouter = Router();

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  url: z.string().trim().min(1).max(2000),
  events: z.array(z.string().trim().min(1).max(64)).min(1).max(16),
  secret: z.string().max(500).optional(),
  enabled: z.boolean().optional(),
});

webhooksRouter.get('/events', (_req: Request, res: Response) => {
  res.json({ events: [...WEBHOOK_EVENTS, '*'] });
});

webhooksRouter.get('/', (_req: Request, res: Response) => {
  res.json({ webhooks: listWebhooks() });
});

webhooksRouter.post('/', (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.issues.map(e => e.message).join(', ') } });
    return;
  }
  try {
    res.status(201).json({ webhook: createWebhook(getDb(), parsed.data) });
  } catch (err) {
    res.status(400).json({ error: { message: err instanceof Error ? err.message : String(err) } });
  }
});

webhooksRouter.delete('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { message: 'Invalid webhook ID' } });
    return;
  }
  if (!deleteWebhook(getDb(), id)) {
    res.status(404).json({ error: { message: 'Webhook not found' } });
    return;
  }
  res.json({ deleted: id });
});

webhooksRouter.post('/:id/test', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { message: 'Invalid webhook ID' } });
    return;
  }
  if (!fireWebhookTest(id)) {
    res.status(404).json({ error: { message: 'Webhook not found' } });
    return;
  }
  res.status(202).json({ fired: id });
});
