import { afterEach, describe, expect, it, vi } from 'vitest';
import { transcribeAudio } from '../../lib/voice.js';

describe('transcribeAudio', () => {
  const nativeFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = nativeFetch;
    vi.unstubAllGlobals();
  });

  it('passes auto through instead of rewriting to a concrete id', async () => {
    let seenModel = '';
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      seenModel = (init.body as FormData).get('model') as string;
      return new Response(JSON.stringify({ text: 'hello' }), { status: 200 });
    }));
    const text = await transcribeAudio(new Blob(['x']), 'dictation.webm', 'key', 'auto');
    expect(text).toBe('hello');
    expect(seenModel).toBe('auto');
  });

  it('rejects empty recordings before any request', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    await expect(transcribeAudio(new Blob([]), 'dictation.webm', 'key', 'auto')).rejects.toThrow('nothing was recorded');
    expect(spy).not.toHaveBeenCalled();
  });
});
