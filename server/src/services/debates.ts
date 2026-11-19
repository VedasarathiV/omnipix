import { getDb } from '../db/index.js';
import type { Db } from '../db/types.js';
import { estimateInputTokens } from '../lib/content.js';
import { runModelCall } from './fusion.js';
import {
  pinnedModelFitsRequestSize,
  resolveFusionCandidate,
  routePinnedModel,
  routeRequest,
  routingReserveTokens,
} from './router.js';
import type { ChatMessage } from '@omnipix/shared/types.js';

/**
 * debates — consensus rounds between models.
 *
 * Fusion asks N models once and blends. A debate goes further: every round
 * each model reads the other models' previous answers and may rebut or
 * revise, then a judge delivers the verdict from the full transcript. Async
 * with durable rounds (debates can run for minutes); the dashboard polls.
 *
 * Cost caps live here, not in the route: 2-4 models, 1-3 rounds.
 */

const DEBATE_TAG = 'debate';
const DEBATE_ATTEMPTS = 2;
export const DEBATE_MIN_MODELS = 2;
export const DEBATE_MAX_MODELS = 4;
export const DEBATE_MIN_ROUNDS = 1;
export const DEBATE_MAX_ROUNDS = 3;

export interface DebateAnswer {
  model: string;
  displayName: string;
  ok: boolean;
  text?: string;
  error?: string;
  latencyMs: number;
}

export interface DebateRound {
  round: number;
  answers: DebateAnswer[];
}

export interface DebateVerdict {
  judge: string;
  displayName: string;
  text: string;
  latencyMs: number;
}

export interface Debate {
  id: number;
  prompt: string;
  models: string[];
  judge: string | null;
  rounds: DebateRound[];
  verdict: DebateVerdict | null;
  status: string;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

interface DebateRow {
  id: number;
  prompt: string;
  models_json: string;
  judge: string | null;
  rounds_json: string;
  verdict_json: string | null;
  status: string;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

function toDebate(row: DebateRow): Debate {
  return {
    id: row.id,
    prompt: row.prompt,
    models: JSON.parse(row.models_json) as string[],
    judge: row.judge,
    rounds: JSON.parse(row.rounds_json) as DebateRound[],
    verdict: row.verdict_json ? (JSON.parse(row.verdict_json) as DebateVerdict) : null,
    status: row.status,
    error: row.error,
    created_at: row.created_at,
    finished_at: row.finished_at,
  };
}

export function createDebate(
  db: Db,
  input: { prompt: string; models: string[]; judge?: string },
): Debate {
  const row = db.prepare(
    'INSERT INTO debates (prompt, models_json, judge) VALUES (?, ?, ?) RETURNING *',
  ).get(input.prompt, JSON.stringify(input.models), input.judge ?? null) as DebateRow;
  return toDebate(row);
}

export function getDebate(db: Db, id: number): Debate | null {
  const row = db.prepare('SELECT * FROM debates WHERE id = ?').get(id) as DebateRow | undefined;
  return row ? toDebate(row) : null;
}

export function listDebates(db: Db, limit = 20): Debate[] {
  const capped = Math.min(100, Math.max(1, limit));
  return (db.prepare('SELECT * FROM debates ORDER BY id DESC LIMIT ?').all(capped) as DebateRow[]).map(toDebate);
}

interface ResolvedDebater {
  id: number;
  modelId: string;
  displayName: string;
}

function roundPrompt(prompt: string, previous: DebateAnswer[], self: string): ChatMessage[] {
  if (!previous.length) return [{ role: 'user', content: prompt }];
  const others = previous
    .filter(a => a.model !== self && a.ok && a.text)
    .map(a => `--- ${a.displayName} ---\n${a.text}`)
    .join('\n\n');
  return [{
    role: 'user',
    content: `Original question:\n${prompt}\n\nOther models answered:\n${others || '(no other answers)'}\n\nCritique the other answers, defend or revise your own position, and reply with your updated answer.`,
  }];
}

async function callDebater(
  entry: ResolvedDebater,
  messages: ChatMessage[],
  options: { max_tokens?: number; temperature?: number },
): Promise<DebateAnswer> {
  const startedAt = Date.now();
  const base = { model: entry.modelId, displayName: entry.displayName };
  const estimatedTokens = estimateInputTokens(messages) + routingReserveTokens(options.max_tokens);
  if (!pinnedModelFitsRequestSize(entry.id, estimatedTokens)) {
    return { ...base, ok: false, error: "Request exceeds this model's context window or TPM ceiling.", latencyMs: Date.now() - startedAt };
  }
  const outcome = await runModelCall(
    (skipKeys) => routePinnedModel(entry.id, estimatedTokens, skipKeys),
    messages,
    options,
    estimatedTokens,
    DEBATE_ATTEMPTS,
    () => 'rate_limited',
    DEBATE_TAG,
  );
  return outcome.ok
    ? { ...base, ok: true, text: outcome.text ?? '', latencyMs: Date.now() - startedAt }
    : { ...base, ok: false, error: outcome.error ?? 'call failed', latencyMs: Date.now() - startedAt };
}

/**
 * Run the debate to completion, persisting each round as it lands. Resolves
 * when the verdict (or error) is stored; throws nothing — failures land on
 * the row.
 */
export async function executeDebate(
  debateId: number,
  input: { rounds: number; max_tokens?: number; temperature?: number },
): Promise<void> {
  const db = getDb();
  const fail = (message: string): void => {
    db.prepare("UPDATE debates SET status = 'error', error = ?, finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?")
      .run(message, debateId);
  };
  try {
    const debate = getDebate(db, debateId);
    if (!debate) return;
    const resolved: ResolvedDebater[] = [];
    for (const modelId of debate.models) {
      const candidate = resolveFusionCandidate(modelId, { allowGroupFallback: false });
      if (!candidate) {
        fail(`Unknown or disabled model: ${modelId}.`);
        return;
      }
      resolved.push({ id: candidate.modelDbId, modelId: candidate.modelId, displayName: candidate.displayName });
    }
    const rounds: DebateRound[] = [];
    let previous: DebateAnswer[] = [];
    for (let round = 0; round < input.rounds; round++) {
      const answers = await Promise.all(
        resolved.map(entry => callDebater(entry, roundPrompt(debate.prompt, previous, entry.modelId), {
          max_tokens: input.max_tokens,
          temperature: input.temperature,
        })),
      );
      rounds.push({ round, answers });
      previous = answers;
      db.prepare('UPDATE debates SET rounds_json = ? WHERE id = ?').run(JSON.stringify(rounds), debateId);
      if (!answers.some(a => a.ok)) {
        fail(`Round ${round}: every model failed.`);
        return;
      }
    }
    // Verdict: pinned judge when named, otherwise the live chain's pick.
    let judgeRoute: { platform: string; modelId: string; displayName: string } | null = null;
    let judgeDisplay = '';
    if (debate.judge) {
      const candidate = resolveFusionCandidate(debate.judge, { allowGroupFallback: false });
      if (!candidate) {
        fail(`Unknown or disabled judge model: ${debate.judge}.`);
        return;
      }
      judgeRoute = { platform: candidate.platform, modelId: candidate.modelId, displayName: candidate.displayName };
      judgeDisplay = candidate.displayName;
    }
    const transcript = rounds.map(r =>
      `## Round ${r.round}\n` + r.answers.map(a => `### ${a.displayName}\n${a.ok ? a.text : `(failed: ${a.error})`}`).join('\n\n'),
    ).join('\n\n');
    const judgeMessages: ChatMessage[] = [{
      role: 'user',
      content: `You are the judge of a model debate.\n\nQuestion:\n${debate.prompt}\n\nTranscript:\n${transcript}\n\nDeliver the verdict: which position holds up best and why, then give the consensus answer.`,
    }];
    const judgeTokens = estimateInputTokens(judgeMessages) + routingReserveTokens(input.max_tokens);
    const startedAt = Date.now();
    const judgeOutcome = judgeRoute
      ? await runModelCall(
        (skipKeys) => {
          const candidate = resolveFusionCandidate(debate.judge!, { allowGroupFallback: false });
          return candidate ? routePinnedModel(candidate.modelDbId, judgeTokens, skipKeys) : null;
        },
        judgeMessages,
        { max_tokens: input.max_tokens, temperature: input.temperature },
        judgeTokens,
        DEBATE_ATTEMPTS,
        () => 'rate_limited',
        DEBATE_TAG,
      )
      : await runModelCall(
        (skipKeys, skipModels) => {
          try {
            return routeRequest(judgeTokens, skipKeys, undefined, false, false, skipModels);
          } catch {
            return null;
          }
        },
        judgeMessages,
        { max_tokens: input.max_tokens, temperature: input.temperature },
        judgeTokens,
        DEBATE_ATTEMPTS,
        () => 'rate_limited',
        DEBATE_TAG,
      );
    if (!judgeOutcome.ok) {
      fail(`Judge failed: ${judgeOutcome.error ?? 'call failed'}.`);
      return;
    }
    const verdict: DebateVerdict = {
      judge: judgeRoute?.modelId ?? judgeOutcome.route?.modelId ?? 'auto',
      displayName: judgeDisplay || judgeOutcome.route?.displayName || 'auto',
      text: judgeOutcome.text ?? '',
      latencyMs: Date.now() - startedAt,
    };
    db.prepare("UPDATE debates SET status = 'done', verdict_json = ?, finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?")
      .run(JSON.stringify(verdict), debateId);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}
