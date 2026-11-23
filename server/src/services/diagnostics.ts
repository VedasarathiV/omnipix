import { getAppVersion } from '../lib/app-version.js';
import { getDb, getSetting } from '../db/index.js';
import type { Db } from '../db/types.js';
import { queryLogs } from '../lib/server-logs.js';

/**
 * diagnostics — one-click support bundle (GET /api/diagnostics/bundle).
 *
 * Everything a bug report needs, nothing it must not contain: counts and
 * statuses everywhere, secret-bearing columns (key ciphertext, env blobs,
 * tokens) never selected, and free-text fields scrubbed for token-shaped
 * strings. Settings are allowlisted key by key — a new secret-bearing
 * setting is excluded until someone lists it here deliberately.
 */

const SAFE_SETTINGS = [
  'active_profile_id',
  'catalog_applied_tier',
  'catalog_applied_version',
  'catalog_last_error',
  'catalog_last_sync_ms',
  'embeddings_default_family',
  'enable_mcp',
  'ollama_emulation',
  'security_scan_next',
  'total_input_tokens',
  'total_output_tokens',
  'total_requests',
] as const;

/** Scrub anything shaped like a pasted secret from free-text fields. */
export function redactFreeText(value: string): string {
  return value
    .replace(/(sk-[A-Za-z0-9_-]{8,})/g, '[redacted]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~-]+/gi, '$1[redacted]')
    .replace(/([A-Za-z0-9_-]{32,})/g, '[redacted]');
}

function count(db: Db, sql: string, ...params: unknown[]): number {
  try {
    return (db.prepare(sql).get(...params) as { c: number }).c;
  } catch {
    return -1;
  }
}

function grouped(db: Db, sql: string): Record<string, number> {
  const out: Record<string, number> = {};
  try {
    for (const row of db.prepare(sql).all() as Array<{ k: string; c: number }>) {
      out[String(row.k)] = row.c;
    }
  } catch {
    // A missing table on an old DB yields {} rather than a failed bundle.
  }
  return out;
}

export interface DiagnosticsBundle {
  generatedAt: string;
  app: { version: string | null; installMethod: string | null; desktop: boolean };
  runtime: { node: string; platform: string; arch: string };
  database: { migrations: number; latestMigration: string | null; tables: Record<string, number> };
  settings: Record<string, string>;
  catalog: { appliedVersion: string; appliedTier: string; lastSyncMs: string; lastError: string };
  providers: { keysByPlatform: Record<string, number>; keysByStatus: Record<string, number>; disabledKeys: number };
  models: { total: number; enabled: number; bySource: Record<string, number> };
  agents: {
    runsByStatus: Record<string, number>;
    groups: number;
    groupTasksByStatus: Record<string, number>;
    approvalsPending: number;
    sessions: number;
  };
  automations: { total: number; enabled: number };
  skills: { total: number; enabled: number; builtin: number };
  mcp: { servers: number; enabled: number };
  memories: { total: number };
  logs: Array<{ ts: string; level: string; source: string; message: string }>;
}

export function collectDiagnosticsBundle(db: Db = getDb()): DiagnosticsBundle {
  const tables: Record<string, number> = {};
  for (const table of [
    'models', 'media_models', 'embedding_models', 'api_keys', 'skills', 'memories',
    'agent_runs', 'agent_steps', 'agent_groups', 'agent_tasks', 'approvals',
    'automations', 'mcp_servers', 'eval_suites', 'eval_runs', 'backups', 'notifications',
  ]) {
    tables[table] = count(db, `SELECT COUNT(*) AS c FROM ${table}`);
  }

  let migrations = -1;
  let latestMigration: string | null = null;
  try {
    migrations = (db.prepare('SELECT COUNT(*) AS c FROM migrations').get() as { c: number }).c;
    latestMigration = (
      db.prepare('SELECT filename FROM migrations ORDER BY id DESC LIMIT 1').get() as { filename: string } | undefined
    )?.filename ?? null;
  } catch {
    // Pre-migrations DB: leave the sentinels.
  }

  const settings: Record<string, string> = {};
  for (const key of SAFE_SETTINGS) {
    const value = getSetting(key);
    if (value !== undefined) settings[key] = key === 'catalog_last_error' ? redactFreeText(value) : value;
  }

  const logs = queryLogs({ limit: 100 }).map((entry) => ({
    ts: new Date(entry.tsMs).toISOString(),
    level: entry.level,
    source: entry.source ?? '',
    message: redactFreeText(entry.message).slice(0, 500),
  }));

  return {
    generatedAt: new Date().toISOString(),
    app: {
      version: getAppVersion(),
      installMethod: process.env.OMNIPIX_INSTALL_METHOD?.trim() || null,
      desktop: process.env.OMNIPIX_DESKTOP === '1',
    },
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    database: { migrations, latestMigration, tables },
    settings,
    catalog: {
      appliedVersion: settings.catalog_applied_version ?? '',
      appliedTier: settings.catalog_applied_tier ?? '',
      lastSyncMs: settings.catalog_last_sync_ms ?? '',
      lastError: settings.catalog_last_error ?? '',
    },
    providers: {
      keysByPlatform: grouped(db, 'SELECT platform AS k, COUNT(*) AS c FROM api_keys GROUP BY platform'),
      keysByStatus: grouped(db, 'SELECT status AS k, COUNT(*) AS c FROM api_keys GROUP BY status'),
      disabledKeys: count(db, 'SELECT COUNT(*) AS c FROM api_keys WHERE enabled = 0'),
    },
    models: {
      total: tables.models,
      enabled: count(db, 'SELECT COUNT(*) AS c FROM models WHERE enabled = 1'),
      bySource: grouped(db, 'SELECT source AS k, COUNT(*) AS c FROM models GROUP BY source'),
    },
    agents: {
      runsByStatus: grouped(db, 'SELECT status AS k, COUNT(*) AS c FROM agent_runs GROUP BY status'),
      groups: count(db, 'SELECT COUNT(*) AS c FROM agent_groups'),
      groupTasksByStatus: grouped(db, 'SELECT status AS k, COUNT(*) AS c FROM agent_tasks GROUP BY status'),
      approvalsPending: count(db, "SELECT COUNT(*) AS c FROM approvals WHERE status = 'pending'"),
      sessions: count(db, 'SELECT COUNT(*) AS c FROM agent_sessions'),
    },
    automations: {
      total: tables.automations,
      enabled: count(db, 'SELECT COUNT(*) AS c FROM automations WHERE enabled = 1'),
    },
    skills: {
      total: tables.skills,
      enabled: count(db, 'SELECT COUNT(*) AS c FROM skills WHERE enabled = 1'),
      builtin: count(db, 'SELECT COUNT(*) AS c FROM skills WHERE builtin = 1'),
    },
    mcp: {
      servers: tables.mcp_servers,
      enabled: count(db, 'SELECT COUNT(*) AS c FROM mcp_servers WHERE enabled = 1'),
    },
    memories: { total: tables.memories },
    logs,
  };
}
