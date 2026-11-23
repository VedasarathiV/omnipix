import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

// Minimal hand-built one-page PDF (no fixture files needed).
function miniPdf(marker: string): string {
  const text = `BT /F1 12 Tf 10 180 Td (${marker}) Tj ET`;
  const pdf =
    '%PDF-1.4\n' +
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n' +
    `4 0 obj<</Length ${text.length + 1}>>stream\n${text}\nendstream\nendobj\n` +
    '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n' +
    'trailer<</Root 1 0 R>>\n';
  return Buffer.from(pdf, 'latin1').toString('base64');
}

beforeEach(() => {
  process.env.ENCRYPTION_KEY = '0'.repeat(64);
  initDb(':memory:');
  app = createApp();
  dashToken = mintDashboardToken();
});

describe('pdf upload parsing', () => {
  it('requires dashboard auth', async () => {
    expect((await call('POST', '/api/uploads/parse-pdf', { filename: 'x.pdf', dataBase64: 'eA==' }, false)).status).toBe(401);
  });

  it('extracts text from a real PDF', async () => {
    const res = await call('POST', '/api/uploads/parse-pdf', { filename: 'doc.pdf', dataBase64: miniPdf('PDFE2E_MARKER') });
    expect(res.status).toBe(200);
    expect(res.body.text).toContain('PDFE2E_MARKER');
    expect(res.body.truncated).toBe(false);
  });

  it('rejects non-pdfs, wrong extensions, and oversize payloads', async () => {
    const notPdf = await call('POST', '/api/uploads/parse-pdf', {
      filename: 'doc.pdf', dataBase64: Buffer.from('just text').toString('base64'),
    });
    expect(notPdf.status).toBe(400);
    const wrongExt = await call('POST', '/api/uploads/parse-pdf', {
      filename: 'doc.txt', dataBase64: miniPdf('x'),
    });
    expect(wrongExt.status).toBe(400);
    const big = await call('POST', '/api/uploads/parse-pdf', {
      filename: 'big.pdf', dataBase64: Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64'),
    });
    expect(big.status).toBe(400);
  });
});
