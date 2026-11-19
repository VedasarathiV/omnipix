import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { createSession, deleteSession, getSession, listSessions } from '../services/agent-sessions.js';
import { listAgentRuns } from '../services/agent-runtime.js';

export const agentSessionsRouter = Router();

const createSessionSchema = z.object({
  title: z.string().trim().max(120).optional(),
  conversationId: z.number().int().positive().optional(),
});

agentSessionsRouter.get('/sessions', (req: Request, res: Response) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  res.json({ sessions: listSessions(limit) });
});

agentSessionsRouter.post('/sessions', (req: Request, res: Response) => {
  const parsed = createSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.issues.map(e => e.message).join(', ') } });
    return;
  }
  try {
    const id = createSession(parsed.data.title || 'Untitled session', parsed.data.conversationId);
    res.status(201).json(getSession(id));
  } catch (err) {
    res.status(400).json({ error: { message: err instanceof Error ? err.message : String(err) } });
  }
});

agentSessionsRouter.get('/sessions/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { message: 'Invalid session ID' } });
    return;
  }
  const session = getSession(id);
  if (!session) {
    res.status(404).json({ error: { message: 'Session not found' } });
    return;
  }
  res.json({ ...session, runs: listAgentRuns(100, id) });
});

agentSessionsRouter.delete('/sessions/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { message: 'Invalid session ID' } });
    return;
  }
  if (!deleteSession(id)) {
    res.status(404).json({ error: { message: 'Session not found' } });
    return;
  }
  res.json({ deleted: id });
});
