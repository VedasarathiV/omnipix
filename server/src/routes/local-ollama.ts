import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { connectLocalOllama, getOllamaStatus, pullOllamaModel } from '../services/local-ollama.js';

export const localOllamaRouter = Router();

localOllamaRouter.get('/ollama', async (_req: Request, res: Response) => {
  res.json({ ollama: await getOllamaStatus() });
});

localOllamaRouter.post('/ollama/connect', async (_req: Request, res: Response) => {
  try {
    const result = await connectLocalOllama();
    res.status(201).json({ success: true, ...result, status: await getOllamaStatus() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /not running|no chat models/.test(message) ? 422 : 502;
    res.status(status).json({ error: { message } });
  }
});

const pullSchema = z.object({ model: z.string().trim().min(1).max(200) });

localOllamaRouter.post('/ollama/pull', async (req: Request, res: Response) => {
  const parsed = pullSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.issues.map(e => e.message).join(', ') } });
    return;
  }
  try {
    const result = await pullOllamaModel(parsed.data.model);
    res.status(201).json({ success: true, ...result, status: await getOllamaStatus() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /required|Invalid/.test(message) ? 400 : 502;
    res.status(status).json({ error: { message } });
  }
});
