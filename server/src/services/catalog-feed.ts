import crypto from 'crypto';
import http from 'node:http';
import type { Db } from '../db/types.js';
import type {
  Catalog,
  CatalogDecisionModel,
  CatalogEmbedding,
  CatalogModel,
  CatalogSearchEngine,
  CatalogTranscriptionModel,
  CatalogVideoModel,
} from './catalog-sync.js';
import { listQuirkDefinitions } from './quirks.js';

/**
 * catalog-feed — the publishing half of the catalog sync loop.
 *
 * catalog-sync.ts is the client: it fetches GET {CATALOG_BASE_URL}/v1/latest,
 * verifies the Ed25519 x-catalog-signature header, and applies the document.
 * This module is the server side: export the curated DB state to a Catalog
 * document, sign the exact bytes served, and (for local/test feeds) serve
 * them over HTTP. Operator runbook: server/src/scripts/catalog-feed.md.
 */

export interface FeedKeypair {
  publicKeyPem: string;
  privateKeyPem: string;
}

export function generateFeedKeypair(): FeedKeypair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

/** Sign the exact response bytes. Returns the x-catalog-signature value. */
export function signCatalogBytes(bytes: Buffer, privateKeyPem: string): string {
  const key = crypto.createPrivateKey({ key: privateKeyPem, format: 'pem' });
  return crypto.sign(null, bytes, key).toString('base64');
}

/** Mirror of the sync path's verification, for tests and the runbook. */
export function verifyCatalogBytes(bytes: Buffer, signatureB64: string, publicKeyPem: string): boolean {
  try {
    const key = crypto.createPublicKey({ key: publicKeyPem, format: 'pem' });
    return crypto.verify(null, bytes, key, Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}

function parseMeta(metaJson: string | null): Record<string, unknown> {
  if (!metaJson) return {};
  try {
    const parsed: unknown = JSON.parse(metaJson);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

interface ChatRow {
  platform: string;
  model_id: string;
  display_name: string;
  intelligence_rank: number;
  speed_rank: number;
  size_label: string;
  rpm_limit: number | null;
  rpd_limit: number | null;
  tpm_limit: number | null;
  tpd_limit: number | null;
  monthly_token_budget: string | null;
  context_window: number | null;
  enabled: number;
  supports_vision: number;
  supports_tools: number;
}

interface MediaRow {
  platform: string;
  model_id: string;
  display_name: string;
  modality: string;
  priority: number;
  enabled: number;
  quota_label: string;
  meta_json: string | null;
}

interface EmbeddingRow {
  family: string;
  platform: string;
  model_id: string;
  display_name: string;
  dimensions: number;
  max_input_tokens: number | null;
  priority: number;
  enabled: number;
  quota_label: string;
}

export interface ExportOptions {
  version: string;
  tier: 'live' | 'monthly';
  generatedAt?: string;
}

/**
 * Export the curated catalog state to a feed document — the exact inverse of
 * applyCatalog. User rows (source='user') and custom-platform rows are local
 * data, never published. Unknown-modality media rows are skipped: older
 * binaries would ingest them through the wrong registry.
 */
export function exportCatalogDocument(db: Db, opts: ExportOptions): Catalog {
  const models: CatalogModel[] = (
    db
      .prepare(
        `SELECT platform, model_id, display_name, intelligence_rank, speed_rank, size_label,
                rpm_limit, rpd_limit, tpm_limit, tpd_limit, monthly_token_budget, context_window,
                enabled, supports_vision, supports_tools
           FROM models
          WHERE platform != 'custom' AND source != 'user'
          ORDER BY platform ASC, model_id ASC`,
      )
      .all() as ChatRow[]
  ).map((m) => ({
    platform: m.platform,
    modelId: m.model_id,
    displayName: m.display_name,
    intelligenceRank: m.intelligence_rank,
    speedRank: m.speed_rank,
    sizeLabel: m.size_label,
    limits: { rpm: m.rpm_limit, rpd: m.rpd_limit, tpm: m.tpm_limit, tpd: m.tpd_limit },
    monthlyTokenBudget: m.monthly_token_budget,
    contextWindow: m.context_window,
    enabled: m.enabled === 1,
    supportsVision: m.supports_vision === 1,
    supportsTools: m.supports_tools === 1,
  }));

  const mediaRows = db
    .prepare(
      `SELECT platform, model_id, display_name, modality, priority, enabled, quota_label, meta_json
         FROM media_models
         ORDER BY platform ASC, model_id ASC`,
    )
    .all() as MediaRow[];

  const transcriptionModels: CatalogTranscriptionModel[] = [];
  const videoModels: CatalogVideoModel[] = [];
  const searchEngines: CatalogSearchEngine[] = [];
  const decisionModels: CatalogDecisionModel[] = [];

  for (const m of mediaRows) {
    const meta = parseMeta(m.meta_json);
    const base = {
      platform: m.platform,
      modelId: m.model_id,
      displayName: m.display_name,
      priority: m.priority,
      enabled: m.enabled === 1,
    };
    if (m.modality === 'image' || m.modality === 'audio') {
      // Generative media rides in models[] with a modality marker; the
      // intelligence rank round-trips through the media priority column.
      const entry: CatalogModel = {
        ...base,
        intelligenceRank: m.priority,
        speedRank: 0,
        sizeLabel: '',
        limits: { rpm: null, rpd: null, tpm: null, tpd: null },
        monthlyTokenBudget: null,
        contextWindow: null,
        supportsVision: false,
        supportsTools: false,
        modality: m.modality,
        mediaNote: m.quota_label,
      };
      if (typeof meta.requestStyle === 'string') entry.requestStyle = meta.requestStyle;
      models.push(entry);
    } else if (m.modality === 'transcription') {
      const entry: CatalogTranscriptionModel = { ...base };
      if (m.quota_label) entry.quotaLabel = m.quota_label;
      if (Array.isArray(meta.subtitleFormats)) {
        entry.subtitleFormats = (meta.subtitleFormats as unknown[]).filter((f): f is string => typeof f === 'string');
      }
      if (typeof meta.maxBytes === 'number') entry.maxBytes = meta.maxBytes;
      if (typeof meta.requestStyle === 'string') entry.requestStyle = meta.requestStyle;
      transcriptionModels.push(entry);
    } else if (m.modality === 'video') {
      const entry: CatalogVideoModel = { ...base };
      if (m.quota_label) entry.quotaLabel = m.quota_label;
      if (typeof meta.providerModelId === 'string') entry.providerModelId = meta.providerModelId;
      videoModels.push(entry);
    } else if (m.modality === 'search') {
      const entry: CatalogSearchEngine = {
        platform: m.platform,
        engineId: m.model_id,
        displayName: m.display_name,
        priority: m.priority,
        enabled: m.enabled === 1,
      };
      if (m.quota_label) entry.quotaLabel = m.quota_label;
      if (typeof meta.creditsPerQuery === 'number' || meta.creditsPerQuery === null) {
        entry.creditsPerQuery = meta.creditsPerQuery;
      }
      if (meta.features && typeof meta.features === 'object') {
        const f = meta.features as Record<string, unknown>;
        entry.features = {
          ...(typeof f.news === 'boolean' ? { news: f.news } : {}),
          ...(typeof f.answer === 'boolean' ? { answer: f.answer } : {}),
          ...(typeof f.fullContent === 'boolean' ? { fullContent: f.fullContent } : {}),
        };
      }
      if (typeof meta.premiumSince === 'string') entry.premiumSince = meta.premiumSince;
      searchEngines.push(entry);
    } else if (m.modality === 'decision') {
      const entry: CatalogDecisionModel = { ...base };
      if (m.quota_label) entry.quotaLabel = m.quota_label;
      if (typeof meta.contextWindow === 'number') entry.contextWindow = meta.contextWindow;
      if (typeof meta.premiumSince === 'string') entry.premiumSince = meta.premiumSince;
      decisionModels.push(entry);
    }
    // Unknown modalities are skipped, never published.
  }

  const embeddings: CatalogEmbedding[] = (
    db
      .prepare(
        `SELECT family, platform, model_id, display_name, dimensions, max_input_tokens,
                priority, enabled, quota_label
           FROM embedding_models
           ORDER BY platform ASC, model_id ASC`,
      )
      .all() as EmbeddingRow[]
  ).map((m) => ({
    family: m.family,
    platform: m.platform,
    modelId: m.model_id,
    displayName: m.display_name,
    dimensions: m.dimensions,
    maxInputTokens: m.max_input_tokens,
    priority: m.priority,
    enabled: m.enabled === 1,
    quotaLabel: m.quota_label,
  }));

  return {
    version: opts.version,
    generatedAt: opts.generatedAt ?? new Date().toISOString(),
    tier: opts.tier,
    models,
    embeddings,
    transcriptionModels,
    videoModels,
    searchEngines,
    decisionModels,
    quirks: listQuirkDefinitions(db).map((q) => ({
      slug: q.slug,
      title: q.title,
      body: q.body,
      severity: q.severity as 'blocker' | 'warning' | 'info',
      targets: q.targets.map((t) => ({ platform: t.platform, modelGlob: t.modelGlob })),
    })),
  };
}

export interface FeedDocument {
  version: string;
  bytes: Buffer;
  signatureB64: string;
}

export interface FeedServer {
  server: http.Server;
  url: string;
}

/**
 * Minimal feed origin for local/test deployments: GET /v1/latest serves the
 * signed bytes with x-catalog-signature; ?since=<applied version> short-circuits
 * to 304. Production wants any static host that can set one response header
 * (see the runbook); the wire contract is identical.
 */
export async function createFeedServer(doc: FeedDocument, port = 0): Promise<FeedServer> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://feed');
    if (req.method !== 'GET' || url.pathname !== '/v1/latest') {
      res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'not found' }));
      return;
    }
    if (url.searchParams.get('since') === doc.version) {
      res.writeHead(304).end();
      return;
    }
    res
      .writeHead(200, {
        'content-type': 'application/json',
        'content-length': doc.bytes.length,
        'x-catalog-signature': doc.signatureB64,
      })
      .end(doc.bytes);
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const address = server.address();
  const boundPort = typeof address === 'object' && address ? address.port : 0;
  return { server, url: `http://127.0.0.1:${boundPort}` };
}
