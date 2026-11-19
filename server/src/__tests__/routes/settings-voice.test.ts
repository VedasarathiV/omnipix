import { describe, it, expect, beforeEach } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb } from '../../db/index.js';
import { mintDashboardToken, isGatedApiPath } from '../helpers/auth.js';

let app: Express;
let dashToken: string;

async function call(method: string, path: string, body?: unknown, authed = true) {
  const server = app.listen(0, '127.0.0.1');
  if (!server.listening) await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const addr = server.address() as { port: number };
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authed && isGatedApiPath(path)) headers['Authorization'] = `Bearer ${dashToken}`;
  const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  server.close();
  return { status: res.status, body: data as any };
}

describe('voice settings', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    app = createApp();
    dashToken = mintDashboardToken();
  });

  it('requires dashboard auth', async () => {
    expect((await call('GET', '/api/settings/voice', undefined, false)).status).toBe(401);
  });

  it('returns defaults, then round-trips a patch', async () => {
    const initial = await call('GET', '/api/settings/voice');
    expect(initial.status).toBe(200);
    expect(initial.body).toMatchObject({
      ttsModel: 'auto', ttsVoice: '', sttModel: 'auto', autoSpeakChat: false, autoSpeakRuns: false,
    });
    const updated = await call('PUT', '/api/settings/voice', { ttsVoice: 'nova', autoSpeakRuns: true });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ ttsVoice: 'nova', autoSpeakRuns: true, ttsModel: 'auto' });
    const reread = await call('GET', '/api/settings/voice');
    expect(reread.body).toMatchObject({ ttsVoice: 'nova', autoSpeakRuns: true });
  });

  it('rejects bad patches', async () => {
    const { status } = await call('PUT', '/api/settings/voice', { autoSpeakChat: 'yes-please' });
    expect(status).toBe(400);
  });
});
