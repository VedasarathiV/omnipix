import { OpenAICompatProvider } from './openai-compat.js';

export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

/** DeepSeek platform API — OpenAI-compatible with no /v1 path segment, so the
 *  base URL is the bare host and the shared adapter appends /chat/completions
 *  and /models itself. Bearer keys from https://platform.deepseek.com/api_keys.
 *
 *  Models (Nov 2026 docs): deepseek-flash (V4.1-Flash, 1M ctx, vision+tools)
 *  and deepseek-v4-pro (V4-Pro, 1M ctx, tools, no vision). Thinking mode is ON
 *  by default server-side; reasoning_effort (low/high/max) is forwarded by the
 *  shared sampling pipeline, and reasoning_content responses are folded into
 *  content by the shared adapter. The `thinking` toggle itself is not sent
 *  (v1) — DeepSeek's default matches. Paid API (no free tier): flash bills
 *  ~$0.30/$1.20 per 1M in/out at peak, pro ~$1.32/$3.96.
 *  https://api-docs.deepseek.com/
 */
export class DeepSeekProvider extends OpenAICompatProvider {
  constructor() {
    // Reasoning models can take a while before first byte; DeepSeek documents
    // no streaming TTFB SLA, so allow double the shared default.
    super({ platform: 'deepseek', name: 'DeepSeek', baseUrl: DEEPSEEK_BASE_URL, timeoutMs: 120_000 });
  }
}
