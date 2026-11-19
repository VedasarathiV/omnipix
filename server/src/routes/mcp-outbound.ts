import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  callMcpTool,
  createMcpServer,
  deleteMcpServer,
  getMcpServer,
  listMcpServers,
  listMcpTools,
  testMcpServer,
  updateMcpServer,
} from '../services/mcp-servers.js';

// Outbound MCP registry (Phase 2): CRUD for MCP servers the agent loop
// calls out to, plus test/call helpers. (routes/mcp.ts is the INBOUND MCP
// server other agents use to inspect this gateway.)

export const mcpOutboundRouter = Router();

const serverSchema = z.object({
  name: z.string().trim().min(1).max(64),
  transport: z.enum(['stdio', 'http']),
  command: z.string().max(500).optional(),
  args: z.array(z.string().max(500)).max(50).optional(),
  url: z.string().max(2000).optional(),
  env: z.record(z.string(), z.string().max(4000)).optional(),
  headers: z.record(z.string(), z.string().max(4000)).optional(),
  enabled: z.boolean().optional(),
});

mcpOutboundRouter.get('/servers', (_req: Request, res: Response) => {
  res.json({ servers: listMcpServers() });
});

mcpOutboundRouter.post('/servers', (req: Request, res: Response) => {
  const parsed = serverSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.issues.map(e => e.message).join(', ') } });
    return;
  }
  try {
    const id = createMcpServer(parsed.data);
    res.status(201).json({ server: getMcpServer(id) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('already exists') ? 409 : 400;
    res.status(status).json({ error: { message } });
  }
});

mcpOutboundRouter.get('/servers/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { message: 'Invalid server ID' } });
    return;
  }
  const server = getMcpServer(id);
  if (!server) {
    res.status(404).json({ error: { message: 'MCP server not found' } });
    return;
  }
  res.json({ server });
});

mcpOutboundRouter.patch('/servers/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { message: 'Invalid server ID' } });
    return;
  }
  const parsed = serverSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.issues.map(e => e.message).join(', ') } });
    return;
  }
  try {
    updateMcpServer(id, parsed.data);
    res.json({ server: getMcpServer(id) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message === 'MCP server not found' ? 404 : 400;
    res.status(status).json({ error: { message } });
  }
});

mcpOutboundRouter.delete('/servers/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { message: 'Invalid server ID' } });
    return;
  }
  if (!deleteMcpServer(id)) {
    res.status(404).json({ error: { message: 'MCP server not found' } });
    return;
  }
  res.json({ deleted: id });
});

// Connect + list tools without pooling: the dashboard "test" button.
mcpOutboundRouter.post('/servers/:id/test', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { message: 'Invalid server ID' } });
    return;
  }
  try {
    const result = await testMcpServer(id);
    res.json({ ...result, server: getMcpServer(id) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message === 'MCP server not found' ? 404 : 502;
    res.status(status).json({ error: { message } });
  }
});

// Aggregated namespaced tools across enabled servers, for the run picker
// and the agent loop. Dead servers contribute nothing (see listMcpTools).
mcpOutboundRouter.get('/tools', async (_req: Request, res: Response) => {
  res.json({ tools: await listMcpTools() });
});

const callSchema = z.object({
  tool: z.string().trim().min(1).max(256),
  args: z.record(z.string(), z.unknown()).optional(),
});

// Direct tool call for debugging a server from the dashboard/CLI. Runs
// outside any agent run — no policy gate, operator invoked it explicitly.
mcpOutboundRouter.post('/call', async (req: Request, res: Response) => {
  const parsed = callSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.issues.map(e => e.message).join(', ') } });
    return;
  }
  try {
    const output = await callMcpTool(parsed.data.tool, parsed.data.args ?? {});
    res.json({ output });
  } catch (err) {
    res.status(502).json({ error: { message: err instanceof Error ? err.message : String(err) } });
  }
});
