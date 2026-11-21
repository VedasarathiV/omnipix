import { Router } from 'express';
import type { Request, Response } from 'express';
import { scanAgentFiles } from '../services/file-agents.js';
import { defaultConfigDirs } from '../services/skills-sync.js';

export const agentPresetsRouter = Router();

// Read-only listing of file-defined agent presets for pickers.
agentPresetsRouter.get('/presets', (_req: Request, res: Response) => {
  const presets = scanAgentFiles(defaultConfigDirs()).map(a => ({
    name: a.name,
    description: a.description,
    skills: a.skills ?? [],
    tools: a.tools ?? [],
    model: a.model ?? null,
    planMode: a.planMode ?? false,
  }));
  res.json({ presets });
});
