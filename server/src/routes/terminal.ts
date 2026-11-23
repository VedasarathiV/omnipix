import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { execShell, resolveInRoot, workspaceRoot } from '../lib/workspace.js';

export const terminalRouter = Router();

// Standalone terminal for the operator (VS Code-style): run shell commands
// without an agent run. The typed command IS the approval — same as any
// local terminal — so there is no approval gate. Same guardrails as agent
// shell: denylist, timeouts, output caps. cwd resolves inside the workspace
// root by default; an absolute directory opts out (the dashboard operator
// already holds equivalent local-exec power via MCP servers, so this adds
// no new privilege — but every invocation is audit-logged).

const terminalExecSchema = z.object({
  command: z.string().trim().min(1).max(4000),
  cwd: z.string().trim().min(1).max(1024).optional(),
  timeoutMs: z.number().int().min(1000).max(300000).optional(),
});

function resolveTerminalCwd(cwd: string | undefined): string {
  const root = workspaceRoot();
  if (!cwd) return root;
  if (path.isAbsolute(cwd)) {
    const abs = path.resolve(cwd);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
      throw new Error(`cwd is not a directory: ${cwd.slice(0, 120)}`);
    }
    return abs;
  }
  const abs = resolveInRoot(root, cwd);
  if (!fs.existsSync(abs)) fs.mkdirSync(abs, { recursive: true });
  return abs;
}

terminalRouter.post('/exec', async (req: Request, res: Response) => {
  const parsed = terminalExecSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.issues.map(e => e.message).join(', ') } });
    return;
  }
  try {
    const cwd = resolveTerminalCwd(parsed.data.cwd);
    console.warn(`[terminal] exec in ${cwd}: ${parsed.data.command.slice(0, 200)}`);
    res.json({ ...(await execShell(parsed.data.command, { cwd, timeoutMs: parsed.data.timeoutMs })), cwd });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: { message } });
  }
});

terminalRouter.get('/cwd', (_req: Request, res: Response) => {
  res.json({ cwd: workspaceRoot() });
});
