import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getDb, initDb } from '../../db/index.js';
import { encrypt } from '../../lib/crypto.js';
import { runTranscription, TRANSCRIPTION_PLATFORMS } from '../../services/media.js';
import { resolveProvider } from '../../providers/index.js';
import { speechFlowCredentials } from '../../providers/speechflow.js';

beforeEach(() => {
  process.env.ENCRYPTION_KEY = '0'.repeat(64);
  initDb(':memory:');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function addKey(platform: string, value: string): void {
  const e = encrypt(value);
  getDb().prepare(
    "INSERT INTO api_keys (platform,label,encrypted_key,iv,auth_tag,status,enabled) VALUES (?,'fixture',?,?,?,'unknown',1)",
  ).run(platform, e.encrypted, e.iv, e.authTag);
}

const MODEL = 'speechflow-asr';
const CLIP = { file: Buffer.from('audio'), filename: 'sample.wav', responseFormat: 'json' };

function seed(value = 'exampleId:exampleSecret'): void {
  addKey('speechflow', value);
  getDb().prepare(
    "INSERT INTO media_models (platform,model_id,display_name,modality,priority,enabled) VALUES ('speechflow',?,?,'transcription',1,1)",
  ).run(MODEL, MODEL);
}

it('uploads once and reads the finished transcript', async () => {
  seed();
  expect(TRANSCRIPTION_PLATFORMS.has('speechflow')).toBe(true);
  expect(resolveProvider('speechflow')).toMatchObject({ supportsChat: false, supportsKeyValidation: false });
  const f = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({ code: 10000, taskId: 'abc-1' }))
    .mockResolvedValueOnce(Response.json({ code: 11001 }))
    .mockResolvedValueOnce(Response.json({ code: 11000, result: 'Bonjour' }));
  await expect(runTranscription(MODEL, { ...CLIP, language: 'fr' })).resolves.toMatchObject({
    text: 'Bonjour', language: 'fr', platform: 'speechflow',
  });
  expect(f.mock.calls.map(c => c[0])).toEqual([
    'https://api.speechflow.io/asr/file/v1/create?lang=fr',
    'https://api.speechflow.io/asr/file/v1/query?taskId=abc-1&resultType=4',
    'https://api.speechflow.io/asr/file/v1/query?taskId=abc-1&resultType=4',
  ]);
  for (const [, init] of f.mock.calls) {
    expect(init?.redirect).toBe('error');
    expect(new Headers(init?.headers).get('keySecret')).toBe('exampleSecret');
    expect(new Headers(init?.headers).get('keyId')).toBe('exampleId');
  }
  expect((f.mock.calls[0][1]?.body as FormData).get('file')).toBeTruthy();
});

it('rejects malformed credentials before sending the audio', async () => {
  for (const v of ['a', ':a', 'a:b:c', 'a:b\r\nx:y']) expect(speechFlowCredentials(v)).toBeNull();
  seed('broken');
  const f = vi.spyOn(globalThis, 'fetch');
  await expect(runTranscription(MODEL, CLIP)).rejects.toThrow();
  expect(f).not.toHaveBeenCalled();
});

it.each([{ code: 999, result: 'not success' }, { code: 11000, result: 42 }])(
  'does not treat an unfinished or malformed result as success',
  async state => {
    seed();
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ code: 10000, taskId: 'abc' }))
      .mockResolvedValueOnce(Response.json(state));
    await expect(runTranscription(MODEL, CLIP)).rejects.toThrow();
  },
);
