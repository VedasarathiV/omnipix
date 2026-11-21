import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb } from '../../db/index.js';
import { setGuardedFetchResolve } from '../../lib/guarded-fetch.js';
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

describe('skills', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    app = createApp();
    dashToken = mintDashboardToken();
  });

  it('requires dashboard auth', async () => {
    expect((await call('GET', '/api/skills', undefined, false)).status).toBe(401);
  });

  it('lists the seeded skills', async () => {
    const { status, body } = await call('GET', '/api/skills');
    expect(status).toBe(200);
    expect(body.skills.map((s: any) => s.name).sort()).toEqual([
      'accessibility-auditor', 'api-tester', 'appsec-engineer', 'backend-architect',
      'code-reviewer', 'critic', 'database-optimizer', 'devops-automator',
      'frontend-developer', 'incident-responder', 'penetration-tester', 'planner',
      'prompt-engineer', 'reality-checker', 'researcher', 'sre',
      'technical-writer', 'test-automation-engineer',
    ]);
  });

  it('seeds condensed, valid personas', async () => {
    const { body } = await call('GET', '/api/skills');
    const personas = body.skills.filter((s: any) => !['critic', 'planner', 'researcher'].includes(s.name));
    expect(personas).toHaveLength(15);
    for (const skill of personas) {
      expect(skill.name).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      expect(skill.builtin).toBe(1);
      expect(skill.enabled).toBe(1);
      expect(skill.description.length).toBeGreaterThan(10);
      // Condensed for injection: full personas would bloat every prompt.
      expect(skill.instructions.length).toBeLessThanOrEqual(2000);
      expect(skill.instructions).toContain('Output:');
    }
  });

  it('creates, updates, and deletes a custom skill', async () => {
    const created = await call('POST', '/api/skills', {
      name: 'summarizer', description: 'Summarize', instructions: 'Be brief.',
    });
    expect(created.status).toBe(201);
    expect(created.body.skill).toMatchObject({ name: 'summarizer', enabled: 1, builtin: 0 });

    const dup = await call('POST', '/api/skills', {
      name: 'summarizer', description: 'x', instructions: 'y',
    });
    expect(dup.status).toBe(409);

    const updated = await call('PATCH', '/api/skills/summarizer', { enabled: false });
    expect(updated.status).toBe(200);
    expect(updated.body.skill.enabled).toBe(0);

    const deleted = await call('DELETE', '/api/skills/summarizer');
    expect(deleted.status).toBe(200);
    expect((await call('GET', '/api/skills')).body.skills.map((s: any) => s.name))
      .not.toContain('summarizer');
  });

  it('protects built-in skills from deletion but allows disabling', async () => {
    expect((await call('DELETE', '/api/skills/planner')).status).toBe(403);
    const updated = await call('PATCH', '/api/skills/planner', { enabled: false });
    expect(updated.status).toBe(200);
    expect(updated.body.skill.enabled).toBe(0);
  });

  it('validates names and bodies', async () => {
    expect((await call('POST', '/api/skills', { name: 'Bad Name!', description: 'x', instructions: 'y' })).status).toBe(400);
    expect((await call('PATCH', '/api/skills/nope', { enabled: true })).status).toBe(404);
    expect((await call('PATCH', '/api/skills/planner', {})).status).toBe(400);
  });

  it('exports a skill as SKILL.md content', async () => {
    const exported = await call('GET', '/api/skills/planner/export');
    expect(exported.status).toBe(200);
    expect(exported.body.name).toBe('planner');
    expect(exported.body.content).toContain('---\nname: planner\n');
    expect(exported.body.content).toContain('description: ');
    expect((await call('GET', '/api/skills/nope/export')).status).toBe(404);
    expect((await call('GET', '/api/skills/planner/export', undefined, false)).status).toBe(401);
  });

  it('imports a skill file, round-tripping an export', async () => {
    const exported = await call('GET', '/api/skills/planner/export');
    // Built-ins can't be deleted, so rename the file instead.
    const renamed = (exported.body.content as string).replace('name: planner', 'name: planner-copy');
    const imported = await call('POST', '/api/skills/import', { content: renamed });
    expect(imported.status).toBe(201);
    expect(imported.body.skill).toMatchObject({ name: 'planner-copy', builtin: 0, enabled: 1 });
    expect((await call('POST', '/api/skills/import', { content: renamed })).status).toBe(409);
  });

  it('stores an agency duplicate of a builtin as disabled', async () => {
    const exported = await call('GET', '/api/skills/planner/export');
    const dupe = (exported.body.content as string).replace('name: planner', 'name: agency-planner');
    const imported = await call('POST', '/api/skills/import', { content: dupe });
    expect(imported.status).toBe(201);
    expect(imported.body.skill).toMatchObject({ name: 'agency-planner', builtin: 0, enabled: 0 });
    expect(imported.body.dedupedAgainst).toBe('planner');
    // Non-duplicates still import enabled.
    const fresh = (exported.body.content as string).replace('name: planner', 'name: agency-brand-new-thing');
    const imported2 = await call('POST', '/api/skills/import', { content: fresh });
    expect(imported2.status).toBe(201);
    expect(imported2.body.skill).toMatchObject({ name: 'agency-brand-new-thing', enabled: 1 });
    expect(imported2.body.dedupedAgainst).toBeUndefined();
  });

  it('rejects malformed skill files', async () => {
    expect((await call('POST', '/api/skills/import', { content: 'no frontmatter here' })).status).toBe(400);
    expect((await call('POST', '/api/skills/import', { content: '---\nname: Bad!\n---\nbody' })).status).toBe(400);
    expect((await call('POST', '/api/skills/import', { content: '---\nname: ok\n---\n' })).status).toBe(400);
    expect((await call('POST', '/api/skills/import', {})).status).toBe(400);
    expect((await call('POST', '/api/skills/import', { content: 'x'.repeat(25001) })).status).toBe(400);
    expect((await call('POST', '/api/skills/import', { content: '---\nname: \' OR \'1\'=\'1\n---\nbody' })).status).toBe(400);
    expect((await call('POST', '/api/skills/import', { content: '---\nname: ../escape\ndescription: d\n---\nbody' })).status).toBe(400);
    expect((await call('POST', '/api/skills/import', { content: 'x' }, false)).status).toBe(401);
  });

  it('creates a bundle and expands it on selection', async () => {
    const created = await call('POST', '/api/skills', {
      name: 'review-pack', description: 'Review skills.', instructions: 'Review thoroughly.',
      bundle: ['planner', 'critic'],
    });
    expect(created.status).toBe(201);
    expect(created.body.skill.bundle).toEqual(['planner', 'critic']);
    const listed = await call('GET', '/api/skills');
    expect(listed.body.skills.find((s: any) => s.name === 'review-pack').bundle).toEqual(['planner', 'critic']);
  });

  it('rejects bad bundle members', async () => {
    const unknown = await call('POST', '/api/skills', {
      name: 'bad-pack', description: 'x', instructions: 'y', bundle: ['nope'],
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.message).toContain('unknown bundle member');

    await call('POST', '/api/skills', {
      name: 'pack-a', description: 'x', instructions: 'y', bundle: ['planner'],
    });
    const nested = await call('POST', '/api/skills', {
      name: 'pack-b', description: 'x', instructions: 'y', bundle: ['pack-a'],
    });
    expect(nested.status).toBe(400);
    expect(nested.body.error.message).toContain('cannot itself be a bundle');

    const self = await call('POST', '/api/skills', {
      name: 'pack-self', description: 'x', instructions: 'y', bundle: ['pack-self'],
    });
    expect(self.status).toBe(400);
    expect(self.body.error.message).toContain('cannot include itself');
  });

  it('honors the enabled flag on import', async () => {
    const imported = await call('POST', '/api/skills/import', {
      content: '---\nname: quiet-one\ndescription: Off by default.\nenabled: false\n---\nShh.',
    });
    expect(imported.status).toBe(201);
    expect(imported.body.skill).toMatchObject({ name: 'quiet-one', enabled: 0 });
  });

  it('still dedupes agency packs after the import refactor', async () => {
    const imported = await call('POST', '/api/skills/import', {
      content: '---\nname: agency-planner\ndescription: Pack planner.\n---\nPack body.',
    });
    expect(imported.status).toBe(201);
    expect(imported.body.skill).toMatchObject({ name: 'agency-planner', enabled: 0 });
    expect(imported.body.dedupedAgainst).toBe('planner');
  });
});

describe('skills import-url', () => {
  const nativeFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    app = createApp();
    dashToken = mintDashboardToken();
    setGuardedFetchResolve(async () => ['93.184.216.34']);
  });

  afterEach(() => {
    globalThis.fetch = nativeFetch;
    setGuardedFetchResolve(null);
  });

  const SKILL_MD = '---\nname: url-skill\ndescription: From URL.\n---\nFetched body.';

  // Stub remote skill hosts; the harness's own loopback calls pass through.
  function stubSkillHosts(handler: (url: string) => Response) {
    globalThis.fetch = (async (input: unknown, init?: unknown) => {
      const url = String(input);
      if (url.includes('skills.test')) return handler(url);
      return nativeFetch(input as string, init as RequestInit);
    }) as typeof fetch;
  }

  it('fetches, parses, and installs a skill file', async () => {
    stubSkillHosts(() => new Response(SKILL_MD, { status: 200 }));
    const res = await call('POST', '/api/skills/import-url', { url: 'https://skills.test/pack/SKILL.md' });
    expect(res.status).toBe(201);
    expect(res.body.skill).toMatchObject({ name: 'url-skill', description: 'From URL.' });
    const dupe = await call('POST', '/api/skills/import-url', { url: 'https://skills.test/pack/SKILL.md' });
    expect(dupe.status).toBe(409);
  });

  it('rejects HTTP failures, oversize bodies, and bad skills', async () => {
    stubSkillHosts(url => {
      if (url.includes('missing')) return new Response('nope', { status: 404 });
      if (url.includes('big')) return new Response('x'.repeat(140001), { status: 200 });
      return new Response('not a skill file', { status: 200 });
    });
    const failed = await call('POST', '/api/skills/import-url', { url: 'https://skills.test/missing.md' });
    expect(failed.status).toBe(400);
    expect(failed.body.error.message).toContain('HTTP 404');
    const big = await call('POST', '/api/skills/import-url', { url: 'https://skills.test/big.md' });
    expect(big.status).toBe(400);
    expect(big.body.error.message).toContain('too large');
    const bad = await call('POST', '/api/skills/import-url', { url: 'https://skills.test/bad.md' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toContain('frontmatter fence');
  });

  it('refuses blocked URLs without fetching', async () => {
    let fetched = false;
    stubSkillHosts(() => {
      fetched = true;
      return new Response(SKILL_MD, { status: 200 });
    });
    const res = await call('POST', '/api/skills/import-url', { url: 'http://127.0.0.1/evil.md' });
    expect(res.status).toBe(400);
    expect(fetched).toBe(false);
  });
});
