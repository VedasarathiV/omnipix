import http from 'node:http';
import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb, getDb } from '../../db/index.js';
import { mintDashboardToken, isGatedApiPath } from '../helpers/auth.js';
import { emitWebhook } from '../../services/webhooks.js';

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

interface Received {
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function startReceiver(status = 200): Promise<{ url: string; received: Received[]; close: () => Promise<void> }> {
  const received: Received[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8'); });
    req.on('end', () => {
      received.push({ headers: req.headers, body });
      res.writeHead(status).end('ok');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      resolve({
        url: `http://127.0.0.1:${port}/hook`,
        received,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

async function waitFor(cond: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (cond()) return;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error(`timed out waiting for ${label}`);
}

describe('webhooks', () => {
  const receivers: Array<() => Promise<void>> = [];

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    app = createApp();
    dashToken = mintDashboardToken();
  });

  afterEach(async () => {
    for (const close of receivers.splice(0)) await close();
  });

  it('requires dashboard auth', async () => {
    expect((await call('GET', '/api/webhooks', undefined, false)).status).toBe(401);
  });

  it('lists known events and manages registrations', async () => {
    const events = await call('GET', '/api/webhooks/events');
    expect(events.body.events).toContain('run.finished');
    expect(events.body.events).toContain('*');

    const created = await call('POST', '/api/webhooks', {
      name: 'local', url: 'http://127.0.0.1:9/hook', events: ['run.finished'], secret: 's3cret',
    });
    expect(created.status).toBe(201);
    expect(created.body.webhook).toMatchObject({ name: 'local', hasSecret: true, enabled: 1 });
    expect(JSON.stringify(created.body)).not.toContain('s3cret');

    expect((await call('POST', '/api/webhooks', {
      name: 'bad', url: 'ftp://x/y', events: ['run.finished'],
    })).status).toBe(400);
    expect((await call('POST', '/api/webhooks', {
      name: 'bad', url: 'http://127.0.0.1:9/hook', events: ['nope.event'],
    })).status).toBe(400);

    const listed = await call('GET', '/api/webhooks');
    expect(listed.body.webhooks).toHaveLength(1);
    expect((await call('DELETE', '/api/webhooks/999')).status).toBe(404);
    expect((await call('DELETE', '/api/webhooks/1')).status).toBe(200);
    expect((await call('GET', '/api/webhooks')).body.webhooks).toHaveLength(0);
  });

  it('delivers signed events to matching hooks only', async () => {
    const target = await startReceiver();
    receivers.push(target.close);
    const other = await startReceiver();
    receivers.push(other.close);

    await call('POST', '/api/webhooks', {
      name: 'runs', url: target.url, events: ['run.finished'], secret: 's3cret',
    });
    await call('POST', '/api/webhooks', { name: 'evals', url: other.url, events: ['eval.finished'] });

    emitWebhook('run.finished', { runId: 7, status: 'done' });
    await waitFor(() => target.received.length === 1, 'delivery');
    // Give the non-matching hook a chance to (incorrectly) fire.
    await new Promise(r => setTimeout(r, 100));
    expect(other.received).toHaveLength(0);

    const [delivery] = target.received;
    expect(delivery.headers['x-omnipix-event']).toBe('run.finished');
    const payload = JSON.parse(delivery.body);
    expect(payload).toMatchObject({ event: 'run.finished', data: { runId: 7, status: 'done' } });
    expect(typeof payload.firedAt).toBe('string');
    const expected = crypto.createHmac('sha256', 's3cret').update(delivery.body).digest('hex');
    expect(delivery.headers['x-omnipix-signature']).toBe(expected);

    const row = getDb().prepare('SELECT last_status, last_error FROM webhooks WHERE name = ?').get('runs') as {
      last_status: number; last_error: string | null;
    };
    expect(row.last_status).toBe(200);
    expect(row.last_error).toBeNull();
  });

  it('records delivery failures on the row instead of throwing', async () => {
    await call('POST', '/api/webhooks', {
      name: 'dead', url: 'http://127.0.0.1:9/hook', events: ['*'],
    });
    emitWebhook('run.finished', { runId: 1 });
    await waitFor(() => {
      const row = getDb().prepare('SELECT last_fired_at FROM webhooks WHERE name = ?').get('dead') as {
        last_fired_at: string | null;
      };
      return row.last_fired_at != null;
    }, 'failure recording');
    const row = getDb().prepare('SELECT last_status, last_error FROM webhooks WHERE name = ?').get('dead') as {
      last_status: number | null; last_error: string;
    };
    expect(row.last_status).toBeNull();
    expect(row.last_error.length).toBeGreaterThan(0);
  });

  it('sends a test delivery to one hook', async () => {
    const target = await startReceiver();
    receivers.push(target.close);
    await call('POST', '/api/webhooks', { name: 't', url: target.url, events: ['eval.finished'] });
    expect((await call('POST', '/api/webhooks/999/test')).status).toBe(404);
    expect((await call('POST', '/api/webhooks/1/test')).status).toBe(202);
    await waitFor(() => target.received.length === 1, 'test delivery');
    expect(JSON.parse(target.received[0].body).data).toMatchObject({ test: true, webhookId: 1 });
  });
});
