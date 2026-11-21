import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { parseCommandFile, scanCommandFiles, serializeCommandFile } from '../services/commands.js';
import { authoringConfigDir, defaultConfigDirs } from '../services/skills-sync.js';

export const commandsRouter = Router();

/** User-global config home for authored files (overridable in tests). */
export function writableConfigDir(): string {
  return authoringConfigDir();
}

const COMMAND_NAME_RE = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/;

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

const createCommandSchema = z.object({
  name: z.string().trim().min(1).max(128).regex(COMMAND_NAME_RE, 'name must be lowercase segments separated by /'),
  description: z.string().trim().min(1).max(1024),
  template: z.string().trim().min(1).max(131072),
  agent: z.string().trim().min(1).max(128).regex(COMMAND_NAME_RE, 'agent must be a valid preset name').optional(),
  model: z.string().trim().min(1).max(200).optional(),
});

commandsRouter.post('/', (req: Request, res: Response) => {
  const parsed = createCommandSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.issues.map(e => e.message).join(', ') } });
    return;
  }
  const file = join(writableConfigDir(), 'commands', `${parsed.data.name}.md`);
  if (existsSync(file)) {
    res.status(409).json({ error: { message: `Command already exists: ${parsed.data.name}` } });
    return;
  }
  const content = serializeCommandFile(parsed.data);
  try {
    parseCommandFile(content, file);
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
  res.status(201).json({ command: { name: parsed.data.name, description: parsed.data.description } });
});
