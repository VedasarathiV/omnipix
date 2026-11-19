import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDb, setSetting } from '../../db/index.js';
import {
  computeCacheKey,
  computeSemanticBucket,
  extractPromptText,
  findSimilarCachedResponse,
  getCacheStats,
  storeCachedResponse,
  clearCache,
  semanticThreshold,
  textSimilarity,
  CACHE_SEMANTIC_THRESHOLD_SETTING,
  type CacheKeyInput,
} from '../../services/cache.js';
import type { ChatMessage } from '@omnipix/shared/types.js';

function msg(role: ChatMessage['role'], content: string): ChatMessage {
  return { role, content } as ChatMessage;
}

const sampleBody = (text: string) => ({
  id: 'chatcmpl-test',
  object: 'chat.completion',
  choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
});

function inputFor(prompt: string, extra?: Partial<CacheKeyInput>): CacheKeyInput {
  return { model: 'auto', messages: [msg('user', prompt)], temperature: 0, ...extra };
}

function store(input: CacheKeyInput, text: string): string {
  const key = computeCacheKey(input);
  storeCachedResponse(key, {
    body: sampleBody(text),
    platform: 'groq',
    modelId: 'llama-3.3-70b',
    keyId: 7,
    promptTokens: 10,
    completionTokens: 5,
    semantic: { bucket: computeSemanticBucket(input), promptText: extractPromptText(input.messages) },
  });
  return key;
}

describe('semantic cache', () => {
  const savedEnv = process.env.RESPONSE_CACHE_SEMANTIC_THRESHOLD;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    delete process.env.RESPONSE_CACHE_SEMANTIC_THRESHOLD;
    initDb(':memory:');
    clearCache();
  });

  afterEach(() => {
    clearCache();
    if (savedEnv === undefined) delete process.env.RESPONSE_CACHE_SEMANTIC_THRESHOLD;
    else process.env.RESPONSE_CACHE_SEMANTIC_THRESHOLD = savedEnv;
  });

  it('is off by default and validates its range', () => {
    expect(semanticThreshold()).toBe(0);
    process.env.RESPONSE_CACHE_SEMANTIC_THRESHOLD = '0.9';
    expect(semanticThreshold()).toBe(0.9);
    setSetting(CACHE_SEMANTIC_THRESHOLD_SETTING, '0.5');
    expect(semanticThreshold()).toBe(0.5);
    for (const bad of ['0', '1', '2', '-0.5', 'nope']) {
      setSetting(CACHE_SEMANTIC_THRESHOLD_SETTING, bad);
      expect(semanticThreshold()).toBe(0);
    }
  });

  it('scores identical prompts 1 and unrelated prompts near 0', () => {
    expect(textSimilarity('user:hello world today', 'user:hello world today')).toBe(1);
    expect(textSimilarity('', 'user:hello')).toBe(0);
    const near = textSimilarity(
      'user:what is the capital of france',
      'user:whats the capital of france',
    );
    expect(near).toBeGreaterThan(0.3);
    expect(near).toBeLessThan(1);
    expect(textSimilarity(
      'user:what is the capital of france please tell me now',
      'user:write a haiku about database indexes quickly',
    )).toBeLessThan(0.2);
  });

  it('extracts and normalizes prompt text', () => {
    expect(extractPromptText([msg('user', 'Hello,  WORLD!')])).toBe('user hello world');
    expect(extractPromptText([])).toBe('');
  });

  it('buckets by model and params, never by prompt', () => {
    const a = inputFor('first prompt here');
    const b = inputFor('second prompt here');
    expect(computeSemanticBucket(a)).toBe(computeSemanticBucket(b));
    expect(computeSemanticBucket(inputFor('x', { model: 'other' }))).not.toBe(computeSemanticBucket(a));
    expect(computeSemanticBucket(inputFor('x', { temperature: 0.7 }))).not.toBe(computeSemanticBucket(a));
  });

  it('returns null when the tier is off', () => {
    store(inputFor('What is the capital of France?'), 'Paris.');
    const query = inputFor('What is the capital of France?!');
    const hit = findSimilarCachedResponse(query, computeCacheKey(query));
    expect(hit).toBeNull();
  });

  it('matches near-duplicates above the threshold', () => {
    setSetting(CACHE_SEMANTIC_THRESHOLD_SETTING, '0.5');
    store(inputFor('What is the capital of France?'), 'Paris.');
    const query = inputFor('What is the capital of France?!');
    const hit = findSimilarCachedResponse(query, computeCacheKey(query));
    expect(hit?.similarity).toBeGreaterThanOrEqual(0.5);
    expect((hit?.body as { choices: Array<{ message: { content: string } }> }).choices[0].message.content).toBe('Paris.');
    expect(getCacheStats().semanticHits).toBe(1);
    expect(getCacheStats().lookupHits).toBe(1);
  });

  it('rejects distant prompts and other buckets', () => {
    setSetting(CACHE_SEMANTIC_THRESHOLD_SETTING, '0.5');
    store(inputFor('What is the capital of France?'), 'Paris.');
    const distant = inputFor('Write a haiku about database indexes');
    expect(findSimilarCachedResponse(distant, computeCacheKey(distant))).toBeNull();
    const otherBucket = inputFor('What is the capital of France?!', { temperature: 0.7 });
    expect(findSimilarCachedResponse(otherBucket, computeCacheKey(otherBucket))).toBeNull();
  });

  it('skips entries without semantic metadata', () => {
    setSetting(CACHE_SEMANTIC_THRESHOLD_SETTING, '0.1');
    const input = inputFor('What is the capital of France?');
    const key = computeCacheKey(input);
    storeCachedResponse(key, {
      body: sampleBody('Paris.'), platform: 'groq', modelId: 'm', keyId: 1,
      promptTokens: 1, completionTokens: 1,
    });
    const query = inputFor('What is the capital of France?!');
    expect(findSimilarCachedResponse(query, computeCacheKey(query))).toBeNull();
  });
});
