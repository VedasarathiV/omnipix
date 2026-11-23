import { getDb } from '../db/index.js';
import { registerCustomModels } from './custom-model-register.js';
import { customEndpointKeyIds } from './custom-endpoint.js';
import { discoverEndpointModels, type DiscoveredModelKind } from './model-discovery.js';

// One-click local Ollama setup: the keyless path. Users who can't pay for API
// keys run models on their own laptop; this module detects the daemon,
// registers it as a custom endpoint, and pulls models — no hand-written API
// calls, no keys. Everything here talks to loopback only.

export const OLLAMA_HOST = 'http://127.0.0.1:11434';
export const OLLAMA_V1_BASE_URL = `${OLLAMA_HOST}/v1`;
export const OLLAMA_LABEL = 'Local Ollama';

export interface OllamaLocalModel {
  name: string;
  size: number | null;
}

export interface OllamaStatus {
  running: boolean;
  version: string | null;
  models: OllamaLocalModel[];
  connected: boolean;
  registeredModels: string[];
}

type FetchFn = typeof fetch;

async function getJson(url: string, fetchFn: FetchFn, timeoutMs: number): Promise<unknown | null> {
  try {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

function registeredOllamaModels(): { connected: boolean; models: string[] } {
  const db = getDb();
  const key = db.prepare(
    "SELECT id FROM api_keys WHERE platform = 'custom' AND base_url = ? ORDER BY id LIMIT 1",
  ).get(OLLAMA_V1_BASE_URL) as { id: number } | undefined;
  if (!key) return { connected: false, models: [] };
  const pool = [...customEndpointKeyIds(db, key.id)];
  const rows = db.prepare(
    `SELECT model_id FROM models WHERE platform = 'custom' AND key_id IN (${pool.map(() => '?').join(',')}) ORDER BY model_id`,
  ).all(...pool) as { model_id: string }[];
  return { connected: true, models: rows.map(r => r.model_id) };
}

/** Probe the local daemon: running? which version? which models pulled? */
export async function getOllamaStatus(fetchFn: FetchFn = fetch): Promise<OllamaStatus> {
  const versionJson = await getJson(`${OLLAMA_HOST}/api/version`, fetchFn, 3000);
  const running = versionJson !== null;
  const version = running
    ? (typeof (versionJson as { version?: unknown }).version === 'string'
      ? (versionJson as { version: string }).version
      : null)
    : null;
  let models: OllamaLocalModel[] = [];
  if (running) {
    const tags = await getJson(`${OLLAMA_HOST}/api/tags`, fetchFn, 5000);
    const list = (tags as { models?: unknown } | null)?.models;
    if (Array.isArray(list)) {
      models = list
        .filter((m): m is { name: string; size?: number } => typeof (m as { name?: unknown })?.name === 'string')
        .map(m => ({ name: m.name, size: typeof m.size === 'number' ? m.size : null }));
    }
  }
  const reg = registeredOllamaModels();
  return { running, version, models, connected: reg.connected, registeredModels: reg.models };
}

function toChatEntries(discovered: { id: string; kind?: DiscoveredModelKind }[]): { modelId: string; displayName: string | null }[] {
  // Chat is the default: kind is only set when the model is discernibly NOT
  // one (#1051). Non-chat kinds stay out — connect is the chat path, and the
  // dashboard's custom form covers the exotic cases.
  return discovered
    .filter(d => d.id && d.kind === undefined)
    .map(d => ({ modelId: d.id, displayName: null }));
}

/**
 * Connect local Ollama in one call: discover its /v1/models and register them
 * as chat models on a keyless custom endpoint. Idempotent — re-running picks
 * up newly pulled models without duplicating rows.
 */
export async function connectLocalOllama(): Promise<{ keyId: number; models: string[]; created: string[] }> {
  const db = getDb();
  const status = await getOllamaStatus();
  if (!status.running) {
    throw new Error('Ollama is not running on this machine. Start it with `ollama serve` (or open the Ollama app) and retry.');
  }
  let discovered;
  try {
    discovered = await discoverEndpointModels(OLLAMA_V1_BASE_URL, 'no-key');
  } catch (err) {
    throw new Error(`Ollama is up but its model list could not be read: ${err instanceof Error ? err.message : String(err)}`);
  }
  const entries = toChatEntries(discovered);
  if (!entries.length) {
    throw new Error('Ollama is running but has no chat models. Pull one first — e.g. `ollama pull qwen2.5-coder:0.5b` — then connect again.');
  }
  const { keyId, registered } = registerCustomModels(db, OLLAMA_V1_BASE_URL, undefined, OLLAMA_LABEL, undefined, entries);
  return {
    keyId,
    models: registered.map(r => r.model),
    created: registered.filter(r => r.created).map(r => r.model),
  };
}

/** Pull a model into the local daemon (long: downloads weights). */
export async function pullOllamaModel(name: string, fetchFn: FetchFn = fetch): Promise<{ name: string; bytes: number | null }> {
  const model = name.trim();
  if (!model || model.length > 200) throw new Error('A model name is required (e.g. qwen2.5-coder:7b).');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(model)) throw new Error('Invalid model name.');
  let res: Response;
  try {
    res = await fetchFn(`${OLLAMA_HOST}/api/pull`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: model, stream: false }),
      signal: AbortSignal.timeout(30 * 60_000),
    });
  } catch (err) {
    throw new Error(`Pull failed: ${err instanceof Error ? err.message : 'Ollama unreachable'}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ollama refused the pull (${res.status}): ${text.slice(0, 300) || res.statusText}`);
  }
  // Register the pulled id so it is routable immediately (best-effort: the
  // weights are local either way, and connect picks up stragglers).
  try {
    registerCustomModels(getDb(), OLLAMA_V1_BASE_URL, undefined, OLLAMA_LABEL, undefined, [
      { modelId: model, displayName: null },
    ]);
  } catch { /* connect covers it */ }
  return { name: model, bytes: null };
}
