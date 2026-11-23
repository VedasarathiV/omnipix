import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { parseAgentFile, scanAgentFiles, serializeAgentFile } from '../services/file-agents.js';
import { defaultConfigDirs } from '../services/skills-sync.js';
import { writableConfigDir } from './commands.js';

export const agentPresetsRouter = Router();

const PRESET_NAME_RE = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/;

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

const wordList = z.array(z.string().trim().min(1).max(128)).max(32).optional();

const createPresetSchema = z.object({
  name: z.string().trim().min(1).max(128).regex(PRESET_NAME_RE, 'name must be lowercase segments separated by /'),
  description: z.string().trim().min(1).max(1024),
  skills: z.array(z.string().trim().min(1).max(64)).max(10).optional(),
  tools: wordList,
  model: z.string().trim().min(1).max(200).optional(),
  planMode: z.boolean().optional(),
  notes: z.string().max(8192).optional(),
});

agentPresetsRouter.post('/presets', (req: Request, res: Response) => {
  const parsed = createPresetSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.issues.map(e => e.message).join(', ') } });
    return;
  }
  const file = join(writableConfigDir(), 'agents', `${parsed.data.name}.md`);
  if (existsSync(file)) {
    res.status(409).json({ error: { message: `Agent preset already exists: ${parsed.data.name}` } });
    return;
  }
  const content = serializeAgentFile(parsed.data);
  try {
    parseAgentFile(content, file);
  } catch (err) {
    res.status(400).json({ error: { message: err instanceof Error ? err.message : String(err) } });
    return;
  }
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content, { flag: 'wx' });
  } catch (err) {
    res.status(400).json({ error: { message: err instanceof Error ? err.message : String(err) } });
    return;
  }
  res.status(201).json({ preset: { name: parsed.data.name, description: parsed.data.description } });
});
