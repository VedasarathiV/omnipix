import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { listSkills } from '../services/agent-runtime.js';
import { parseSkillFile, serializeSkill } from '../services/skill-files.js';

export const skillsRouter = Router();

const bundleSchema = z.array(z.string().trim().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/)).max(8);

const createSkillSchema = z.object({
  name: z.string().trim().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/, 'name must be lowercase letters, numbers, and dashes'),
  description: z.string().trim().min(1).max(1024),
  instructions: z.string().trim().min(1).max(131072),
  bundle: bundleSchema.optional(),
});

const updateSkillSchema = z.object({
  description: z.string().trim().min(1).max(1024).optional(),
  instructions: z.string().trim().min(1).max(131072).optional(),
  enabled: z.boolean().optional(),
  bundle: bundleSchema.optional(),
}).refine(data => data.description !== undefined || data.instructions !== undefined || data.enabled !== undefined || data.bundle !== undefined, {
  message: 'nothing to update',
});

/** Bundle rules: members exist, no self, one level (members are never bundles). Null when valid. */
function validateBundleMembers(name: string, members: string[]): string | null {
  const all = new Map(listSkills().map(s => [s.name, s]));
  for (const member of members) {
    if (member === name) return 'a bundle cannot include itself';
    const row = all.get(member);
    if (!row) return `unknown bundle member: ${member}`;
    if (row.bundle?.length) return `bundle member cannot itself be a bundle: ${member}`;
  }
  return null;
}

skillsRouter.get('/', (_req: Request, res: Response) => {
  res.json({ skills: listSkills() });
});

skillsRouter.post('/', (req: Request, res: Response) => {
  const parsed = createSkillSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.issues.map(e => e.message).join(', ') } });
    return;
  }
  if (parsed.data.bundle !== undefined) {
    const bundleError = validateBundleMembers(parsed.data.name, [...new Set(parsed.data.bundle)]);
    if (bundleError) {
      res.status(400).json({ error: { message: bundleError } });
      return;
    }
  }
  try {
    getDb().prepare('INSERT INTO skills (name, description, instructions, enabled, builtin, bundle_json) VALUES (?, ?, ?, 1, 0, ?)')
      .run(parsed.data.name, parsed.data.description, parsed.data.instructions,
        parsed.data.bundle ? JSON.stringify([...new Set(parsed.data.bundle)]) : null);
  } catch {
    res.status(409).json({ error: { message: `Skill already exists: ${parsed.data.name}` } });
    return;
  }
  res.status(201).json({ skill: listSkills().find(s => s.name === parsed.data.name) });
});

skillsRouter.patch('/:name', (req: Request, res: Response) => {
  const parsed = updateSkillSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.issues.map(e => e.message).join(', ') } });
    return;
  }
  const existing = listSkills().find(s => s.name === req.params.name);
  if (!existing) {
    res.status(404).json({ error: { message: 'Skill not found' } });
    return;
  }
  if (parsed.data.bundle !== undefined) {
    const bundleError = validateBundleMembers(existing.name, [...new Set(parsed.data.bundle)]);
    if (bundleError) {
      res.status(400).json({ error: { message: bundleError } });
      return;
    }
  }
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (parsed.data.description !== undefined) { sets.push('description = ?'); vals.push(parsed.data.description); }
  if (parsed.data.instructions !== undefined) { sets.push('instructions = ?'); vals.push(parsed.data.instructions); }
  if (parsed.data.enabled !== undefined) { sets.push('enabled = ?'); vals.push(parsed.data.enabled ? 1 : 0); }
  if (parsed.data.bundle !== undefined) {
    sets.push('bundle_json = ?');
    vals.push(parsed.data.bundle.length ? JSON.stringify([...new Set(parsed.data.bundle)]) : null);
  }
  getDb().prepare(`UPDATE skills SET ${sets.join(', ')} WHERE name = ?`).run(...vals, req.params.name);
  res.json({ skill: listSkills().find(s => s.name === req.params.name) });
});

skillsRouter.delete('/:name', (req: Request, res: Response) => {
  const existing = listSkills().find(s => s.name === req.params.name);
  if (!existing) {
    res.status(404).json({ error: { message: 'Skill not found' } });
    return;
  }
  if (existing.builtin) {
    res.status(403).json({ error: { message: 'Built-in skills cannot be deleted; disable them instead.' } });
    return;
  }
  getDb().prepare('DELETE FROM skills WHERE name = ?').run(req.params.name);
  res.json({ deleted: req.params.name });
});

skillsRouter.get('/:name/export', (req: Request, res: Response) => {
  const existing = listSkills().find(s => s.name === req.params.name);
  if (!existing) {
    res.status(404).json({ error: { message: 'Skill not found' } });
    return;
  }
  res.json({ name: existing.name, content: serializeSkill(existing) });
});

const importSkillSchema = z.object({
  content: z.string().min(1).max(140000),
});

skillsRouter.post('/import', (req: Request, res: Response) => {
  const parsed = importSkillSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.issues.map(e => e.message).join(', ') } });
    return;
  }
  let skill;
  try {
    skill = parseSkillFile(parsed.data.content);
  } catch (err) {
    res.status(400).json({ error: { message: err instanceof Error ? err.message : String(err) } });
    return;
  }
  if (skill.bundle !== undefined) {
    const bundleError = validateBundleMembers(skill.name, skill.bundle);
    if (bundleError) {
      res.status(400).json({ error: { message: bundleError } });
      return;
    }
  }
  try {
    getDb().prepare('INSERT INTO skills (name, description, instructions, enabled, builtin, bundle_json) VALUES (?, ?, ?, ?, 0, ?)')
      .run(skill.name, skill.description, skill.instructions, skill.enabled ? 1 : 0,
        skill.bundle ? JSON.stringify(skill.bundle) : null);
  } catch {
    res.status(409).json({ error: { message: `Skill already exists: ${skill.name}` } });
    return;
  }
  res.status(201).json({ skill: listSkills().find(s => s.name === skill.name) });
});
