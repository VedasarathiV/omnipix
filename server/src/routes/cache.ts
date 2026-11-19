import { Router } from 'express';
import type { Request, Response } from 'express';
import { setSetting } from '../db/index.js';
import {
  getCacheStats,
  clearCache,
  isCacheEnabled,
  cacheTtlMs,
  cacheMaxEntries,
  cacheMaxTemperature,
  semanticThreshold,
  CACHE_ENABLED_SETTING,
  CACHE_SEMANTIC_THRESHOLD_SETTING,
} from '../services/cache.js';

export const cacheRouter = Router();

// Cache status + savings for the dashboard. "saved" tokens are provider tokens
// that hits avoided spending, i.e. the free-tier quota the cache gave back.
cacheRouter.get('/stats', (_req: Request, res: Response) => {
  const stats = getCacheStats();
  res.json({
    enabled: isCacheEnabled(),
    ttlSeconds: Math.round(cacheTtlMs() / 1000),
    maxEntries: cacheMaxEntries(),
    maxTemperature: cacheMaxTemperature(),
    semanticThreshold: semanticThreshold(),
    ...stats,
    savedTokens: stats.savedPromptTokens + stats.savedCompletionTokens,
  });
});

// Toggle the cache at runtime (no restart). Persisted in settings, which wins
// over the RESPONSE_CACHE env var. Clears the value to fall back to the env
// default when `enabled` is null. `semanticThreshold` (0..1, 0 = off) tunes
// the near-duplicate tier the same way.
cacheRouter.put('/config', (req: Request, res: Response) => {
  const { enabled, semanticThreshold: threshold } = req.body ?? {};
  if (enabled === undefined && threshold === undefined) {
    res.status(400).json({ error: { message: 'Send `enabled` and/or `semanticThreshold`', type: 'invalid_request_error' } });
    return;
  }
  if (enabled === null) {
    setSetting(CACHE_ENABLED_SETTING, '');
  } else if (typeof enabled === 'boolean') {
    setSetting(CACHE_ENABLED_SETTING, enabled ? '1' : '0');
  } else if (enabled !== undefined) {
    res.status(400).json({ error: { message: '`enabled` must be a boolean or null', type: 'invalid_request_error' } });
    return;
  }
  if (threshold !== undefined) {
    if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
      res.status(400).json({ error: { message: '`semanticThreshold` must be a number from 0 to 1 (0 = off)', type: 'invalid_request_error' } });
      return;
    }
    setSetting(CACHE_SEMANTIC_THRESHOLD_SETTING, String(threshold));
  }
  res.json({ enabled: isCacheEnabled(), semanticThreshold: semanticThreshold() });
});

// Flush the cache (e.g. after changing keys/models, or to force fresh answers).
cacheRouter.delete('/', (_req: Request, res: Response) => {
  const removed = clearCache();
  res.json({ cleared: removed });
});
