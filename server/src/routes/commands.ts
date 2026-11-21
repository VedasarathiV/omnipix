import { Router } from 'express';
import type { Request, Response } from 'express';
import { scanCommandFiles } from '../services/commands.js';
import { defaultConfigDirs } from '../services/skills-sync.js';

export const commandsRouter = Router();

// Read-only listing for pickers and palettes. Commands resolve live
// from disk (no DB), so this always shows what /invocation would run.
commandsRouter.get('/', (_req: Request, res: Response) => {
  const commands = scanCommandFiles(defaultConfigDirs()).map(c => ({
    name: c.name,
    description: c.description,
    agent: c.agent ?? null,
    model: c.model ?? null,
    template: c.template,
  }));
  res.json({ commands });
});
