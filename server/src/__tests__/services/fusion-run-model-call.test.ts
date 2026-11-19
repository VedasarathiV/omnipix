import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

// runModelCall accounting: the request-log tag, the #751 empty-completion
// streak exemption shared with the proxy path, and judge mid-stream salvage.

import { initDb, getDb } from '../../db/index.js';
import { runModelCall, runJudgeStreaming } from '../../services/fusion.js';
import { resetEmptyCompletionStreaks } from '../../lib/fallback-loop.js';
import { getAllPenalties, type RouteResult } from '../../services/router.js';
import type { ChatMessage } from '@omnipix/shared/types.js';

const keySeqStart = 960000;
let keySeq = keySeqStart;

function fakeRoute(impl: { chat?: () => unknown; stream?: () => AsyncGenerator }): { route: RouteResult } {
  const n = ++keySeq;
  const route: RouteResult = {
    provider: {
      chatCompletion: impl.chat ?? (async () => { throw new Error('no chat impl'); }),
      streamChatCompletion: impl.stream ?? (async () => { throw new Error('no stream impl'); }),
    } as any,
    modelId: 'fake-tag-model', modelDbId: n, apiKey: 'test-key',
    keyId: n, platform: 'faketag', displayName: 'Fake Tag Model',
    rpdLimit: null, tpdLimit: null,
  };
  return { route };
}

function completion(content: string, finishReason: string | null) {
  return {
    choices: [{ message: { content }, finish_reason: finishReason }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

const MESSAGES: ChatMessage[] = [{ role: 'user', content: 'hi' }];

async function runOnce(route: RouteResult, tag?: string) {
  let served = 0;
  return runModelCall(
    () => (served++ === 0 ? route : null),
    MESSAGES,
    {} as any,
    10,
    1,
    undefined,
    ...(tag === undefined ? [] : [tag] as [string]),
  );
}

function lastRequestRow() {
  return getDb().prepare(
    'SELECT status, input_tokens, output_tokens, requested_model, error FROM requests WHERE model_id = ? ORDER BY id DESC LIMIT 1',
  ).get('fake-tag-model') as any;
}

function cooldownsFor(keyId: number): number {
  return (getDb().prepare('SELECT COUNT(*) AS n FROM rate_limit_cooldowns WHERE platform = ? AND key_id = ?')
    .get('faketag', keyId) as { n: number }).n;
}

function penaltyFor(modelDbId: number) {
  return getAllPenalties().find((p) => p.modelDbId === modelDbId);
}

describe('runModelCall tag and empty-completion accounting', () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
  });

  beforeEach(() => {
    getDb().prepare('DELETE FROM rate_limit_cooldowns').run();
    getDb().prepare('DELETE FROM requests').run();
    resetEmptyCompletionStreaks();
  });

  it("writes the caller's tag (default 'fusion') to the request row", async () => {
    const { route } = fakeRoute({ chat: async () => completion('hi', 'stop') });
    await runOnce(route, 'arena');
    expect(lastRequestRow()).toMatchObject({ status: 'success', requested_model: 'arena' });

    const { route: route2 } = fakeRoute({ chat: async () => completion('hi', 'stop') });
    await runOnce(route2);
    const rows = getDb().prepare(
      "SELECT requested_model FROM requests WHERE model_id = 'fake-tag-model' ORDER BY id",
    ).all() as { requested_model: string }[];
    expect(rows.map(r => r.requested_model)).toEqual(['arena', 'fusion']);
  });

  it("exempts a first 'length' empty from bench and penalty (#751 mirror)", async () => {
    const { route } = fakeRoute({ chat: async () => completion('', 'length') });
    const outcome = await runOnce(route);
    expect(outcome.ok).toBe(false);
    expect(cooldownsFor(route.keyId)).toBe(0);
    expect(penaltyFor(route.modelDbId)).toBeUndefined();
    expect(lastRequestRow()).toMatchObject({ status: 'error' });
  });

  it('benches a non-length empty with the lighter non-429 demotion', async () => {
    const { route } = fakeRoute({ chat: async () => completion('', 'stop') });
    const outcome = await runOnce(route);
    expect(outcome.ok).toBe(false);
    expect(cooldownsFor(route.keyId)).toBe(1);
    // Exactly one priority position (PENALTY_PER_FAIL), not the 429 weight —
    // a weight regression must fail here, not hide behind toBeDefined().
    expect(penaltyFor(route.modelDbId)).toMatchObject({ penalty: 1, count: 1 });
  });

  it('lifts the exemption at the streak limit (third consecutive length-empty)', async () => {
    // Same model+key across calls: one shared streak entry.
    const n = ++keySeq;
    const route: RouteResult = {
      provider: { chatCompletion: async () => completion('', 'length') } as any,
      modelId: 'fake-tag-model', modelDbId: n, apiKey: 'test-key',
      keyId: n, platform: 'faketag', displayName: 'Fake Tag Model',
      rpdLimit: null, tpdLimit: null,
    };
    await runOnce(route);
    await runOnce(route);
    expect(cooldownsFor(n)).toBe(0);
    expect(penaltyFor(n)).toBeUndefined();
    await runOnce(route);
    expect(cooldownsFor(n)).toBe(1);
    expect(penaltyFor(n)).toMatchObject({ penalty: 1, count: 1 });
  });

  it('judge mid-stream error keeps the partial text and logs partial counts', async () => {
    const { route } = fakeRoute({
      stream: async function* () {
        yield { choices: [{ delta: { content: 'partial-answer' }, finish_reason: null }] };
        throw new Error('stream broke');
      },
    });
    const deltas: string[] = [];
    let served = 0;
    const outcome = await runJudgeStreaming(
      () => (served++ === 0 ? route : null),
      MESSAGES,
      {} as any,
      10,
      1,
      { onDelta: (t) => deltas.push(t) },
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.text).toBe('partial-answer');
    expect(deltas).toEqual(['partial-answer']);
    // Counted, not zeroed: the client received these tokens.
    const row = lastRequestRow();
    expect(row.status).toBe('error');
    expect(row.output_tokens).toBe(Math.ceil('partial-answer'.length / 4));
    expect(row.input_tokens).toBe(10);
    // Served until the break: no bench, no penalty.
    expect(cooldownsFor(route.keyId)).toBe(0);
    expect(penaltyFor(route.modelDbId)).toBeUndefined();
  });
});
