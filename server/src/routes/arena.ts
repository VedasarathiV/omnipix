import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { runModelCall } from '../services/fusion.js';
import { routePinnedModel, routingReserveTokens } from '../services/router.js';
import { estimateInputTokens } from '../lib/content.js';
import type { ChatMessage } from '@omnipix/shared/types.js';

export const arenaRouter = Router();

const ARENA_TAG = 'arena';
const ARENA_MAX_MODELS = 6;
const ARENA_ATTEMPTS = 3;

const messageSchema = z.object({
  role: z.enum(['system', 'developer', 'user', 'assistant']),
  content: z.union([z.string(), z.array(z.record(z.string(), z.unknown()))]),
});

const arenaRunSchema = z.object({
  models: z.array(z.string().trim().min(1).max(200)).min(2).max(ARENA_MAX_MODELS),
  messages: z.array(messageSchema).min(1).max(100),
  max_tokens: z.number().int().min(1).max(128000).optional(),
  temperature: z.number().min(0).max(2).optional(),
});

interface ArenaResult {
  model: string;
  displayName: string;
  platform: string;
  ok: boolean;
  text?: string;
  error?: string;
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
}

/**
 * POST /api/arena/run — one prompt, N models, side by side.
 *
 * Each model runs through the same pinned-model runner the fusion panel uses
 * (per-model key rotation, cooldowns, usage + request logging tagged `arena`),
 * fanned out in parallel with per-model isolation: one model's failure never
 * cancels the others. Model ids must name enabled catalog rows; unknown or
 * disabled ids fail the whole request with 400 so a typo can't silently
 * shrink the comparison.
 */
arenaRouter.post('/run', async (req: Request, res: Response) => {
  const parsed = arenaRunSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map(e => e.message).join(', ') });
    return;
  }
  const { models, messages, max_tokens, temperature } = parsed.data;
  const unique = [...new Set(models)];
  if (unique.length !== models.length) {
    res.status(400).json({ error: 'Duplicate model ids in arena request.' });
    return;
  }

  const db = getDb();
  const find = db.prepare('SELECT id, model_id, display_name, platform FROM models WHERE model_id = ? AND enabled = 1');
  const resolved: { id: number; modelId: string; displayName: string; platform: string }[] = [];
  const unknown: string[] = [];
  for (const modelId of unique) {
    const row = find.get(modelId) as { id: number; model_id: string; display_name: string; platform: string } | undefined;
    if (!row) unknown.push(modelId);
    else resolved.push({ id: row.id, modelId: row.model_id, displayName: row.display_name, platform: row.platform });
  }
  if (unknown.length > 0) {
    res.status(400).json({ error: `Unknown or disabled model(s): ${unknown.join(', ')}. Call /v1/models for the available list.` });
    return;
  }

  const chatMessages = messages as ChatMessage[];
  const estimatedTokens = estimateInputTokens(chatMessages) + routingReserveTokens(max_tokens);
  const executionId = randomUUID();

  const runOne = async (entry: (typeof resolved)[number]): Promise<ArenaResult> => {
    const startedAt = Date.now();
    const base: Omit<ArenaResult, 'ok'> & { ok?: boolean } = {
      model: entry.modelId,
      displayName: entry.displayName,
      platform: entry.platform,
      latencyMs: 0,
    };
    try {
      const outcome = await runModelCall(
        (skipKeys) => routePinnedModel(entry.id, estimatedTokens, skipKeys),
        chatMessages,
        { max_tokens, temperature },
        estimatedTokens,
        ARENA_ATTEMPTS,
        () => 'rate_limited',
        ARENA_TAG,
      );
      base.latencyMs = Date.now() - startedAt;
      if (!outcome.ok) {
        return { ...base, ok: false, error: outcome.error ?? 'Model unavailable.' };
      }
      return {
        ...base,
        ok: true,
        text: outcome.text ?? '',
        promptTokens: outcome.usage?.prompt_tokens,
        completionTokens: outcome.usage?.completion_tokens,
      };
    } catch (err) {
      return { ...base, latencyMs: Date.now() - startedAt, ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };

  const results = await Promise.all(resolved.map(runOne));
  res.json({ execution_id: executionId, results });
});
