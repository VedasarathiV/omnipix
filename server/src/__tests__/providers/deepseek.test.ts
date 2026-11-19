import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatCompletionChunk } from '@omnipix/shared/types.js';
import { DeepSeekProvider, DEEPSEEK_BASE_URL } from '../../providers/deepseek.js';
import { getProvider } from '../../providers/index.js';
import { AUTH_JSON_PROVIDER_MAP, parseKeysFromFile } from '../../lib/key-parser.js';

const model = 'deepseek-flash';
const completion = {
  id: 'deepseek-test', object: 'chat.completion', created: 1, model,
  choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
};
const json = (body: unknown, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });

describe('DeepSeek provider', () => {
  afterEach(() => vi.restoreAllMocks());

  it('registers a keyed provider and recognizes explicit key-file names', () => {
    expect(getProvider('deepseek')).toBeInstanceOf(DeepSeekProvider);
    expect(getProvider('deepseek')!.keyless).toBe(false);
    expect(parseKeysFromFile('DEEPSEEK_API_KEY=[REDACTED]', 'keys.env').keys[0].platform).toBe('deepseek');
    expect(AUTH_JSON_PROVIDER_MAP['deepseek']).toBe('deepseek');
  });

  it('targets the bare host (DeepSeek has no /v1 segment) with bearer auth', async () => {
    expect(DEEPSEEK_BASE_URL).toBe('https://api.deepseek.com');
    const fetch = vi.spyOn(global, 'fetch').mockResolvedValue(json(completion));
    await getProvider('deepseek')!.chatCompletion('test-key', [{ role: 'user', content: 'Hi' }], model, { max_tokens: 128 });
    expect(fetch.mock.calls[0][0]).toBe('https://api.deepseek.com/chat/completions');
    const init = fetch.mock.calls[0][1]!;
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer test-key');
    expect(JSON.parse(String(init.body))).toMatchObject({ model, max_tokens: 128 });
  });

  it('preserves usage and provider attribution', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(json(completion));
    const response = await getProvider('deepseek')!.chatCompletion('test-key', [{ role: 'user', content: 'Hi' }], model);
    expect(response.choices[0].message.content).toBe('OK');
    expect(response.usage).toEqual(completion.usage);
    expect(response._routed_via).toEqual({ platform: 'deepseek', model });
  });

  it('streams SSE content to completion', async () => {
    const chunks = [
      { id: 's', object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta: { content: 'O' }, finish_reason: null }] },
      { id: 's', object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta: { content: 'K' }, finish_reason: null }] },
      { id: 's', object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    ];
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } }));
    const output: ChatCompletionChunk[] = [];
    for await (const chunk of getProvider('deepseek')!.streamChatCompletion('test-key', [{ role: 'user', content: 'Hi' }], model)) output.push(chunk);
    expect(output.flatMap(c => c.choices).map(c => c.delta.content ?? '').join('')).toBe('OK');
    expect(output.some(c => c.choices.some(x => x.finish_reason === 'stop'))).toBe(true);
  });

  it('folds thinking-mode reasoning_content into content', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(json({
      ...completion,
      choices: [{ index: 0, message: { role: 'assistant', content: '', reasoning_content: 'thoughts' }, finish_reason: 'stop' }],
    }));
    const response = await getProvider('deepseek')!.chatCompletion('test-key', [{ role: 'user', content: 'Hi' }], model);
    expect(response.choices[0].message.content).toBe('thoughts');
  });

  it('leaves real content and tool calls unfolded', async () => {
    const fetch = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(json({
        ...completion,
        choices: [{ index: 0, message: { role: 'assistant', content: 'answer', reasoning_content: 'thoughts' }, finish_reason: 'stop' }],
      }))
      .mockResolvedValueOnce(json({
        ...completion,
        choices: [{ index: 0, message: { role: 'assistant', content: '', reasoning_content: 'thoughts', tool_calls: [{ id: '1', type: 'function', function: { name: 'f', arguments: '{}' } }] }, finish_reason: 'tool_calls' }],
      }));
    const provider = getProvider('deepseek')!;
    const answered = await provider.chatCompletion('test-key', [{ role: 'user', content: 'Hi' }], model);
    expect(answered.choices[0].message.content).toBe('answer');
    const tools = await provider.chatCompletion('test-key', [{ role: 'user', content: 'Hi' }], model);
    expect(tools.choices[0].message.content).toBe('');
    expect(tools.choices[0].message.tool_calls).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('validates keys against GET /models', async () => {
    const fetch = vi.spyOn(global, 'fetch').mockResolvedValue(json({ object: 'list', data: [{ id: model }] }));
    await expect(getProvider('deepseek')!.validateKey('test-key')).resolves.toBe(true);
    expect(fetch.mock.calls[0][0]).toBe('https://api.deepseek.com/models');
    expect(new Headers(fetch.mock.calls[0][1]?.headers).get('authorization')).toBe('Bearer test-key');
  });

  it.each([401, 403])('rejects invalid credentials (%s)', async status => {
    vi.spyOn(global, 'fetch').mockResolvedValue(json({ error: { message: 'Authentication Fails' } }, status));
    await expect(getProvider('deepseek')!.validateKey('invalid')).resolves.toMatchObject({ valid: false });
  });

  it('preserves rate limits and their retry delay', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(json({ error: { message: 'Rate limit' } }, 429, { 'Retry-After': '30' }));
    await expect(getProvider('deepseek')!.chatCompletion('test-key', [], model)).rejects.toMatchObject({ status: 429, retryAfterMs: 30_000 });
  });

  it('allows 120s before first byte (reasoning models start slowly)', () => {
    delete process.env.PROVIDER_TIMEOUT_DEEPSEEK;
    const provider = new DeepSeekProvider() as unknown as { timeoutMs: number };
    expect(provider.timeoutMs).toBe(120_000);
  });

  it('serves deepseek-v4-pro through the same bare-host wire', async () => {
    const fetch = vi.spyOn(global, 'fetch').mockResolvedValue(json({
      ...completion, model: 'deepseek-v4-pro',
      choices: [{ index: 0, message: { role: 'assistant', content: 'pro' }, finish_reason: 'stop' }],
    }));
    const response = await getProvider('deepseek')!.chatCompletion('test-key', [{ role: 'user', content: 'Hi' }], 'deepseek-v4-pro');
    expect(fetch.mock.calls[0][0]).toBe('https://api.deepseek.com/chat/completions');
    expect(JSON.parse(String(fetch.mock.calls[0][1]!.body))).toMatchObject({ model: 'deepseek-v4-pro' });
    expect(response._routed_via).toEqual({ platform: 'deepseek', model: 'deepseek-v4-pro' });
    expect(response.choices[0].message.content).toBe('pro');
  });

  it('forwards reasoning_effort but never sends the thinking toggle', async () => {
    const fetch = vi.spyOn(global, 'fetch').mockResolvedValue(json(completion));
    await getProvider('deepseek')!.chatCompletion('test-key', [{ role: 'user', content: 'Hi' }], model, {
      reasoning_effort: 'high', thinking: false,
    } as any);
    const body = JSON.parse(String(fetch.mock.calls[0][1]!.body));
    expect(body.reasoning_effort).toBe('high');
    expect(body).not.toHaveProperty('thinking');
  });
});
