import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { runModelCall } from '../services/fusion.js';
import { routePinnedModel, pinnedModelFitsRequestSize, resolveFusionCandidate, routingReserveTokens } from '../services/router.js';
import { estimateInputTokens, messageHasImage } from '../lib/content.js';
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
    res.status(400).json({ error: { message: parsed.error.issues.map(e => e.message).join(', ') } });
    return;
  }
  const { models, messages, max_tokens, temperature } = parsed.data;
  const unique = [...new Set(models)];
  if (unique.length !== models.length) {
    res.status(400).json({ error: { message: 'Duplicate model ids in arena request.' } });
    return;
  }

  // Same deterministic resolution as the fusion panel: exact model_id match
  // ordered by intelligence_rank, preferring a row with routable keys. A bare
  // first-row SELECT could pin a keyless duplicate alias while a configured
  // provider for the same model id sits unused. Group fallback stays OFF: a
  // comparison must never silently substitute a sibling member.
  const resolved: { id: number; modelId: string; displayName: string; platform: string; supportsVision: boolean }[] = [];
  const unknown: string[] = [];
  for (const modelId of unique) {
    const candidate = resolveFusionCandidate(modelId, { allowGroupFallback: false });
    if (!candidate) unknown.push(modelId);
    else resolved.push({ id: candidate.modelDbId, modelId: candidate.modelId, displayName: candidate.displayName, platform: candidate.platform, supportsVision: candidate.supportsVision === 1 });
  }
  if (unknown.length > 0) {
    res.status(400).json({ error: { message: `Unknown or disabled model(s): ${unknown.join(', ')}. Call /v1/models for the available list.` } });
    return;
  }

  const chatMessages = messages as ChatMessage[];
  const estimatedTokens = estimateInputTokens(chatMessages) + routingReserveTokens(max_tokens);
  const hasImageContent = messageHasImage(chatMessages);
  const executionId = randomUUID();

  const runOne = async (entry: (typeof resolved)[number]): Promise<ArenaResult> => {
    const startedAt = Date.now();
    const base: Omit<ArenaResult, 'ok'> & { ok?: boolean } = {
      model: entry.modelId,
      displayName: entry.displayName,
      platform: entry.platform,
      latencyMs: 0,
    };
    // Capability pre-checks: a pinned slot never substitutes, so say WHY a
    // model cannot serve this run instead of burning attempts on it. Per-model
    // (not whole-request) failures — the rest of the comparison still runs.
    if (hasImageContent && !entry.supportsVision) {
      return { ...base, latencyMs: Date.now() - startedAt, ok: false, error: 'Model does not support image input.' };
    }
    if (!pinnedModelFitsRequestSize(entry.id, estimatedTokens)) {
      return { ...base, latencyMs: Date.now() - startedAt, ok: false, error: "Request exceeds this model's context window or TPM ceiling." };
    }
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
