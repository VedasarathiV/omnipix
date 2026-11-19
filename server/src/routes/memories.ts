import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { deleteMemory, getMemory, listMemories, rememberMemory, type MemoryScope } from '../services/memories.js';
import { deleteDoc, ingestUrl, listDocs, searchDocs, syncDocs } from '../services/docs-ingest.js';

export const memoriesRouter = Router();

memoriesRouter.get('/', (req: Request, res: Response) => {
  const scope = typeof req.query.scope === 'string' ? req.query.scope : undefined;
  if (scope !== undefined && scope !== 'user' && scope !== 'project' && scope !== 'entity') {
    res.status(400).json({ error: { message: 'Invalid scope filter' } });
    return;
  }
  const projectKey = typeof req.query.project === 'string' ? req.query.project : undefined;
  res.json({ memories: listMemories(scope as MemoryScope | undefined, projectKey) });
});

const rememberSchema = z.object({
  key: z.string().trim().min(1).max(128),
  value: z.string().trim().min(1).max(2000),
  scope: z.enum(['user', 'project', 'entity']).optional(),
  project: z.string().trim().max(128).optional(),
  importance: z.number().min(0).max(1).optional(),
});

memoriesRouter.post('/', (req: Request, res: Response) => {
  const parsed = rememberSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.issues.map(e => e.message).join(', ') } });
    return;
  }
  try {
    const { id, redactions } = rememberMemory({
      key: parsed.data.key,
      value: parsed.data.value,
      scope: parsed.data.scope,
      projectKey: parsed.data.project,
      importance: parsed.data.importance,
      source: 'user',
    });
    res.status(201).json({ memory: getMemory(id), redactions });
  } catch (err) {
    res.status(400).json({ error: { message: err instanceof Error ? err.message : String(err) } });
  }
});

// ---------------------------------------------------------------- docs ingest
// NOTE: this block must stay ABOVE patch/delete /:id, or Express would
// parse "docs" as a memory id.

const ingestSchema = z.object({
  url: z.string().trim().min(1).max(2000),
  project: z.string().trim().min(1).max(128),
});

memoriesRouter.post('/ingest', async (req: Request, res: Response) => {
  const parsed = ingestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.issues.map(e => e.message).join(', ') } });
    return;
  }
  try {
    const doc = await ingestUrl(parsed.data.url, parsed.data.project);
    res.status(201).json({ doc });
  } catch (err) {
    res.status(400).json({ error: { message: err instanceof Error ? err.message : String(err) } });
  }
});

const docsSyncSchema = z.object({
  project: z.string().trim().min(1).max(128).optional(),
  maxAgeHours: z.number().min(0).max(24 * 365).optional(),
});

memoriesRouter.post('/docs/sync', async (req: Request, res: Response) => {
  const parsed = docsSyncSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.issues.map(e => e.message).join(', ') } });
    return;
  }
  res.json(await syncDocs(parsed.data));
});

memoriesRouter.get('/docs', (req: Request, res: Response) => {
  const project = typeof req.query.project === 'string' ? req.query.project : undefined;
  res.json({ docs: listDocs(project) });
});

memoriesRouter.get('/docs/search', (req: Request, res: Response) => {
  const project = typeof req.query.project === 'string' ? req.query.project : '';
  const query = typeof req.query.q === 'string' ? req.query.q : '';
  const sourceUrl = typeof req.query.url === 'string' ? req.query.url : undefined;
  if (!project.trim() || !query.trim()) {
    res.status(400).json({ error: { message: 'Send project and q.' } });
    return;
  }
  const limit = Math.min(Math.max(Number(req.query.limit) || 5, 1), 10);
  res.json({ chunks: searchDocs(project, query, limit, sourceUrl) });
});

memoriesRouter.delete('/docs', (req: Request, res: Response) => {
  const project = typeof req.query.project === 'string' ? req.query.project : '';
  const url = typeof req.query.url === 'string' ? req.query.url : '';
  if (!project.trim() || !url.trim()) {
    res.status(400).json({ error: { message: 'Send project and url.' } });
    return;
  }
  const removed = deleteDoc(project, url);
  if (!removed) {
    res.status(404).json({ error: { message: 'Doc not found' } });
    return;
  }
  res.json({ deleted: url, chunks: removed });
});

const updateSchema = z.object({
  value: z.string().trim().min(1).max(2000).optional(),
  importance: z.number().min(0).max(1).optional(),
});

memoriesRouter.patch('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { message: 'Invalid memory ID' } });
    return;
  }
  const existing = getMemory(id);
  if (!existing) {
    res.status(404).json({ error: { message: 'Memory not found' } });
    return;
  }
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success || (parsed.data.value === undefined && parsed.data.importance === undefined)) {
    res.status(400).json({ error: { message: 'Send value and/or importance.' } });
    return;
  }
  // Reuse rememberMemory for validation + redaction; the unique triple
  // (scope, project, key) makes it an upsert onto the same row.
  const { redactions } = rememberMemory({
    scope: existing.scope,
    projectKey: existing.project_key,
    key: existing.key,
    value: parsed.data.value ?? existing.value,
    importance: parsed.data.importance ?? existing.importance,
    source: existing.source,
  });
  res.json({ memory: getMemory(id), redactions });
});

memoriesRouter.delete('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { message: 'Invalid memory ID' } });
    return;
  }
  if (!deleteMemory(id)) {
    res.status(404).json({ error: { message: 'Memory not found' } });
    return;
  }
  res.json({ deleted: id });
});

