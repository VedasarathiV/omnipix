import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { initDb, getDb, setSetting } from '../../db/index.js';
import { MIN_CONTEXT_WINDOW_SETTING } from '../../lib/min-context-window.js';
import { encrypt } from '../../lib/crypto.js';
import {
  routeRequest,
  setRoutingStrategy,
  setExploreEnabled,
  summarizeRoutingDecision,
} from '../../services/router.js';
import { traceRouteEvent } from '../../routes/proxy.js';

function seedKey(platform: string): void {
  const { encrypted, iv, authTag } = encrypt(`${platform}-key`);
  getDb().prepare(
    'INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(platform, 'test', encrypted, iv, authTag, 'healthy', 1);
}

function seedAllPlatformKeys(): void {
  const rows = getDb().prepare('SELECT DISTINCT platform FROM models').all() as { platform: string }[];
  for (const r of rows) seedKey(r.platform);
}

describe('routing decisions', () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
  });

  beforeEach(() => {
    const db = getDb();
    setRoutingStrategy('priority');
    setExploreEnabled(false);
    db.prepare('DELETE FROM api_keys').run();
    db.prepare("DELETE FROM settings WHERE key = 'active_profile_id'").run();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('records strategy, reason, and walk stats on every route', () => {
    seedKey('groq');
    const route = routeRequest();
    expect(route.decision).toMatchObject({ strategy: 'priority', reason: 'first-eligible' });
    expect(route.decision!.considered).toBeGreaterThan(0);
    expect(route.decision!.keylessSkipped).toBeGreaterThanOrEqual(0);
    expect(Object.values(route.decision!.excluded).every(n => n >= 0)).toBe(true);
  });

  it('names preferred-model picks and counts ruled-out rows', () => {
    seedKey('groq');
    seedKey('google');
    const first = routeRequest();
    // Pin a *keyed* sibling: an unkeyed pin correctly falls through.
    const otherRow = getDb().prepare(
      "SELECT id FROM models WHERE platform = 'groq' AND id != ? LIMIT 1",
    ).get(first.modelDbId) as { id: number };
    const pinned = routeRequest(1000, undefined, otherRow.id);
    expect(pinned.modelDbId).toBe(otherRow.id);
    expect(pinned.decision!.reason).toBe('preferred-model');
  });

  it('counts vision exclusions and still picks a seeing model', () => {
    seedAllPlatformKeys();
    const route = routeRequest(1000, undefined, undefined, true);
    const row = getDb().prepare('SELECT supports_vision FROM models WHERE id = ?').get(route.modelDbId) as {
      supports_vision: number;
    };
    expect(row.supports_vision).toBe(1);
    expect(route.decision!.excluded.vision).toBeGreaterThan(0);
  });

  it('counts TPM exclusions on the walk', () => {
    // Explicit two-row chain: the tight-TPM row walks first and must be
    // excluded before the roomy row succeeds. (TPM has no deferral tier,
    // unlike the margin check, so this is order-deterministic.)
    const db = getDb();
    const tight = db.prepare('SELECT * FROM models WHERE tpm_limit IS NOT NULL ORDER BY tpm_limit ASC LIMIT 1').get() as any;
    const roomy = db.prepare('SELECT * FROM models WHERE tpm_limit >= 12000 LIMIT 1').get() as any;
    seedKey(tight.platform);
    if (roomy.platform !== tight.platform) seedKey(roomy.platform);
    const toRow = (m: any, priority: number) => ({
      model_db_id: m.id, priority, enabled: 1, platform: m.platform, model_id: m.model_id,
      display_name: m.display_name, intelligence_rank: m.intelligence_rank, size_label: m.size_label,
      monthly_token_budget: m.monthly_token_budget, rpm_limit: m.rpm_limit, rpd_limit: m.rpd_limit,
      tpm_limit: m.tpm_limit, tpd_limit: m.tpd_limit, supports_vision: m.supports_vision,
      supports_tools: m.supports_tools, context_window: m.context_window, key_id: m.key_id,
      endpoint_scope: m.endpoint_scope ?? '',
    });
    const route = routeRequest(10_000, undefined, undefined, false, false, undefined, [toRow(tight, 1), toRow(roomy, 2)] as any);
    expect(route.modelDbId).toBe(roomy.id);
    expect(route.decision!.excluded.tpm).toBe(1);
  });

  it('respects the pool context floor on the pick', () => {
    seedAllPlatformKeys();
    setSetting(MIN_CONTEXT_WINDOW_SETTING, '512k');
    try {
      const route = routeRequest(1000);
      const row = getDb().prepare('SELECT context_window FROM models WHERE id = ?').get(route.modelDbId) as {
        context_window: number;
      };
      expect(row.context_window).toBeGreaterThanOrEqual(524_288);
    } finally {
      setSetting(MIN_CONTEXT_WINDOW_SETTING, 'off');
    }
  });

  it('names exploration probes under the bandit', () => {
    setRoutingStrategy('balanced');
    setExploreEnabled(true);
    seedAllPlatformKeys();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const route = routeRequest();
    expect(route.decision!.reason).toBe('exploration-probe');
  });

  it('summarizes decisions in one stable log line', () => {
    expect(summarizeRoutingDecision({
      strategy: 'balanced', reason: 'first-eligible', considered: 22, keylessSkipped: 3,
      excluded: { ruledOut: 0, providerRuledOut: 0, vision: 3, tools: 0, structured: 0, context: 0, tpm: 1, noKey: 0 },
    })).toBe('balanced:first-eligible considered=22 excluded=vision×3,tpm×1');
  });

  it('trace events carry the decision as why=', () => {
    const seen: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => { seen.push(args.map(String).join(' ')); };
    try {
      traceRouteEvent('Proxy', {
        event: 'start', requestId: 'r1', attempt: 0, platform: 'groq', model: 'm',
        decision: 'balanced:first-eligible considered=22',
      });
    } finally {
      console.log = orig;
    }
    expect(seen.join('\n')).toContain('why=balanced:first-eligible considered=22');
  });
});
