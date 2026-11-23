import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initDb, getDb } from '../../db/index.js';
import { encrypt } from '../../lib/crypto.js';
import {
  __quiesceAgentRuns,
  createAgentRun,
  executeAgentRun,
} from '../../services/agent-runtime.js';

const nativeFetch = globalThis.fetch.bind(globalThis);

function completion(message: Record<string, unknown>, finishReason: string) {
  return new Response(JSON.stringify({
    id: 'x', object: 'chat.completion', created: 1, model: 'llama-3.1-8b-instant',
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function toolCallsResponse(calls: Array<{ name: string; args: string }>) {
  return completion({
    role: 'assistant',
    content: '',
    tool_calls: calls.map((c, i) => ({
      id: `call_${i}`, type: 'function', function: { name: c.name, arguments: c.args },
    })),
  }, 'tool_calls');
}

function seedGroqKey(): void {
  const { encrypted, iv, authTag } = encrypt('groq-key');
  getDb().prepare(
    "INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled) VALUES ('groq', 'test', ?, ?, ?, 'healthy', 1)",
  ).run(encrypted, iv, authTag);
}

function stepKinds(runId: number): string[] {
  return (getDb().prepare('SELECT kind FROM agent_steps WHERE run_id = ? ORDER BY seq').all(runId) as { kind: string }[])
    .map(r => r.kind);
}

describe('agent lifecycle: cancellation and tracing', () => {
  beforeEach(async () => {
    await __quiesceAgentRuns();
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    seedGroqKey();
  });

  afterEach(() => {
    globalThis.fetch = nativeFetch;
    vi.unstubAllGlobals();
  });

  it('a stop during the model call executes zero tools', async () => {
    const controller = new AbortController();
    globalThis.fetch = vi.fn(async () => {
      controller.abort(); // stop lands mid-model-call
      return toolCallsResponse([
        { name: 'calculator', args: '{"expression":"1+1"}' },
        { name: 'calculator', args: '{"expression":"2+2"}' },
      ]);
    }) as unknown as typeof fetch;
    const runId = createAgentRun({ goal: 'add numbers', model: 'auto', tools: ['calculator'] });
    const run = await executeAgentRun(runId, {
      goal: 'add numbers', model: 'auto', tools: ['calculator'], autoApprove: true, signal: controller.signal,
    });
    expect(run.status).toBe('stopped');
    expect(stepKinds(runId)).not.toContain('tool_call');
    expect(stepKinds(runId)).not.toContain('tool_result');
  });

  it('a stop during the model call rejects a text answer too', async () => {
    const controller = new AbortController();
    globalThis.fetch = vi.fn(async () => {
      controller.abort();
      return completion({ role: 'assistant', content: 'all done' }, 'stop');
    }) as unknown as typeof fetch;
    const runId = createAgentRun({ goal: 'say hi', model: 'auto' });
    const run = await executeAgentRun(runId, { goal: 'say hi', model: 'auto', signal: controller.signal });
    expect(run.status).toBe('stopped');
    expect(stepKinds(runId)).not.toContain('answer');
  });

  it('traces tool execution and run finish without argument content', async () => {
    globalThis.fetch = vi.fn(async () =>
      toolCallsResponse([{ name: 'calculator', args: '{"expression":"40+2"}' }]),
    ) as unknown as typeof fetch;
    const seen: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => { seen.push(args.map(String).join(' ')); };
    try {
      const runId = createAgentRun({ goal: 'add numbers', model: 'auto', tools: ['calculator'] });
      // Second turn answers so the run terminates.
      let calls = 0;
      (globalThis.fetch as any) = vi.fn(async () => {
        calls++;
        return calls === 1
          ? toolCallsResponse([{ name: 'calculator', args: '{"expression":"40+2"}' }])
          : completion({ role: 'assistant', content: '42' }, 'stop');
      });
      const run = await executeAgentRun(runId, {
        goal: 'add numbers', model: 'auto', tools: ['calculator'], autoApprove: true,
      });
      expect(run.status).toBe('done');
    } finally {
      console.log = origLog;
    }
    const trace = seen.join('\n');
    expect(trace).toContain('tool-start');
    expect(trace).toContain('tool=calculator');
    expect(trace).toContain('tool-ok');
    expect(trace).toContain('run-finish');
    expect(trace).toContain('status=done');
    expect(trace).not.toContain('40+2');
  });
});
