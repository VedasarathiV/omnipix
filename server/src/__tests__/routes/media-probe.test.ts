import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../app.js';
import { initDb } from '../../db/index.js';
import { mintDashboardToken, isGatedApiPath } from '../helpers/auth.js';

// POST /api/media/probe: reachability check for a custom endpoint, without
// saving anything. The stub below stands in for a local STT engine.

let dashToken = '';

async function post(app: Express, path: string, body: unknown) {
  const server = app.listen(0, '127.0.0.1');
  if (!server.listening) await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const addr = server.address() as any;
  const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(isGatedApiPath(path) ? { Authorization: `Bearer ${dashToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  server.close();
  return { status: res.status, body: data as any };
}

describe('POST /api/media/probe', () => {
  let app: Express;
  let stub: http.Server;
  let stubUrl: string;

  beforeEach(async () => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    app = createApp();
    dashToken = mintDashboardToken();
    stub = http.createServer((req, res) => {
      if (req.url === '/models') {
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"data":[]}');
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>(resolve => stub.listen(0, '127.0.0.1', () => resolve()));
    stubUrl = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => stub.close(err => (err ? reject(err) : resolve())));
  });

  it('reports reachable with the answering path', async () => {
    const { status, body } = await post(app, '/api/media/probe', { baseUrl: stubUrl });
    expect(status).toBe(200);
    expect(body).toMatchObject({ reachable: true, status: 200, endpoint: '/models' });
  });

  it('counts any HTTP response as reachable, even a 404', async () => {
    const { status, body } = await post(app, '/api/media/probe', { baseUrl: `${stubUrl}/v1` });
    expect(status).toBe(200);
    // /v1/models and /v1/v1/models 404 on the stub — still a server at home.
    expect(body).toMatchObject({ reachable: true, status: 404 });
  });

  it('reports unreachable for a dead port with the error', async () => {
    const { status, body } = await post(app, '/api/media/probe', { baseUrl: 'http://127.0.0.1:1', timeoutMs: 1000 });
    expect(status).toBe(200);
    expect(body.reachable).toBe(false);
    expect(typeof body.error).toBe('string');
  });

  it('rejects a bad URL with 400', async () => {
    const { status } = await post(app, '/api/media/probe', { baseUrl: 'not-a-url' });
    expect(status).toBe(400);
  });
});
