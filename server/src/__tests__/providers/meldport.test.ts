import { afterEach, describe, expect, it, vi } from 'vitest';
import { getProvider } from '../../providers/index.js';

const meld = getProvider('meldport')!;
const route = 'gpt-6-luna:free';
const messages = [{ role: 'user' as const, content: 'Hello' }];
const payload = (model = 'gpt-6-luna') => ({
  model,
  choices: [{ index: 0, message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
});
const headers = { 'x-meldport-funding': 'promo' };

afterEach(() => vi.restoreAllMocks());

describe('Meldport promo-only chat', () => {
  it('uses the free alias, rejects redirects and requires promo confirmation', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(payload(), { headers }));
    expect((await meld.chatCompletion('test', messages, route)).choices[0].message.content).toBe('Hi');
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toBe('https://api.meldport.com/v1/chat/completions');
    expect(new Headers(init?.headers).get('x-meldport-funding')).toBe('promo');
    expect(init?.redirect).toBe('error');
    expect(JSON.parse(String(init?.body)).model).toBe(route);
  });

  it.each(['wallet', ''])('does not accept funding %j', async funding => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(payload(), { headers: { 'x-meldport-funding': funding } }));
    await expect(meld.chatCompletion('test', messages, route)).rejects.toThrow('funding');
  });

  it('never dispatches held aliases and rejects substituted models', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(payload('other'), { headers }));
    for (const id of ['glm-5.3-flash:free', 'gpt-6-luna']) {
      await expect(meld.chatCompletion('test', messages, id)).rejects.toThrow('Unsupported');
    }
    expect(f).not.toHaveBeenCalled();
    await expect(meld.chatCompletion('test', messages, route)).rejects.toThrow('unexpected model');
  });
});
