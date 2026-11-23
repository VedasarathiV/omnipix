import type { NextFunction, Request, Response } from 'express';
import {
  collectInboundText,
  findBlockedMatch,
  getBlockedPatterns,
  getInboundGuardMode,
  getOutboundGuardMode,
  mapInboundText,
  mapOutboundText,
  redactBlockedSpans,
  redactPii,
} from '../lib/content-guard.js';

// Chat-completion paths across the mounted protocols. Embeddings, model
// management, and moderation endpoints are deliberately NOT guarded: rewriting
// an embedding input would corrupt the vector, and the blocklist is a chat
// safety control, not a whole-gateway filter.
const GUARDED_SUFFIXES = [
  '/chat/completions',
  '/messages',
  '/responses',
  '/api/chat',
  '/api/generate',
  ':generateContent',
  ':streamGenerateContent',
];

function isGuardedChatPath(originalUrl: string): boolean {
  const path = originalUrl.split('?')[0];
  return GUARDED_SUFFIXES.some(suffix => path.endsWith(suffix));
}

export interface ContentGuardStats {
  inboundRedactions: number;
  inboundBlocks: number;
  outboundRedactions: number;
}

const stats: ContentGuardStats = { inboundRedactions: 0, inboundBlocks: 0, outboundRedactions: 0 };

export function getContentGuardStats(): ContentGuardStats {
  return { ...stats };
}

/** Test seam: reset the process-lifetime counters. */
export function resetContentGuardStats(): void {
  stats.inboundRedactions = 0;
  stats.inboundBlocks = 0;
  stats.outboundRedactions = 0;
}

/**
 * Gateway-side content guardrail middleware. Mount after the JSON body
 * parser, before the protocol routers. When every knob is off (the default)
 * this is one settings read and a path check per request.
 */
export function contentGuard() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const inboundMode = getInboundGuardMode();
    const outboundMode = getOutboundGuardMode();
    if (inboundMode === 'off' && outboundMode === 'off') {
      next();
      return;
    }
    if (req.method !== 'POST' || !isGuardedChatPath(req.originalUrl ?? req.url)) {
      next();
      return;
    }

    const patterns = getBlockedPatterns();

    if (inboundMode === 'block' && patterns.length > 0) {
      const texts = collectInboundText(req.body);
      for (const text of texts) {
        if (findBlockedMatch(text, patterns) >= 0) {
          stats.inboundBlocks += 1;
          res.status(400).json({
            error: {
              message: 'Request blocked by the gateway content guard: prompt matches a blocked pattern.',
              type: 'invalid_request_error',
              code: 'content_guard_blocked',
            },
          });
          return;
        }
      }
    }

    if (inboundMode === 'redact') {
      mapInboundText(req.body, text => {
        const { text: redacted, redactions } = redactPii(text);
        stats.inboundRedactions += redactions;
        return redacted;
      });
    }

    if (outboundMode === 'redact') {
      const originalJson = res.json.bind(res);
      res.json = ((body: unknown) => {
        mapOutboundText(body, text => {
          const pii = redactPii(text);
          const blocked = redactBlockedSpans(pii.text, patterns);
          stats.outboundRedactions += pii.redactions + blocked.redactions;
          return blocked.text;
        });
        return originalJson(body as never);
      }) as typeof res.json;
    }

    next();
  };
}
