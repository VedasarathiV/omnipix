import dns from 'node:dns';
import { isBlockedFetchUrl } from './fetch-guard.js';
import { assessProviderUrl } from './url-guard.js';

// DNS-aware SSRF guard for untrusted-URL fetches (agent fetch_url tool and
// docs ingest). Deliberately NOT in fetch-guard.ts: that module is pure by
// design (see module-purity.test.ts) and DNS resolution is I/O.
//
// Why this exists: the sync literal check waves `metadata.google.internal`
// and any attacker-controlled domain through, and `redirect: 'follow'`
// requests each hop before the caller ever sees the final URL. This module
// resolves + classifies every address of every hop BEFORE requesting it,
// follows redirects manually, and fails closed on unresolvable hosts.
// Untrusted fetches always block private/loopback (unlike operator-set
// provider URLs, where loopback is the documented local-inference case).
//
// Residual limitation (GAP-SEC-02): the fetch re-resolves DNS at use time,
// so a hostile authoritative server could rebind between check and use.
// Pinning the checked address into the dispatcher is the follow-up.

export const FETCH_GUARD_DNS_TIMEOUT_MS = 5000;
export const FETCH_GUARD_MAX_REDIRECTS = 5;

async function resolveWithTimeout(hostname: string): Promise<string[]> {
  const lookup = dns.promises.lookup(hostname, { all: true, verbatim: true });
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`DNS lookup timed out for ${hostname}`)), FETCH_GUARD_DNS_TIMEOUT_MS);
  });
  const records = await Promise.race([lookup, timeout]);
  return records.map(r => r.address);
}

type ResolveFn = (hostname: string) => Promise<string[]>;

let customResolve: ResolveFn | null = null;

/** Test hook: stub DNS resolution (mirrors setCatalogFallbackFetch). */
export function setGuardedFetchResolve(fn: ResolveFn | null): void {
  customResolve = fn;
}

export interface GuardedFetchOptions {
  // Per-call resolver override; wins over the module hook above.
  resolve?: ResolveFn;
}

function activeResolve(opts: GuardedFetchOptions): ResolveFn {
  return opts.resolve ?? customResolve ?? resolveWithTimeout;
}

/**
 * DNS-aware fetch guard. Sync literal pre-check first (fast reject), then
 * resolve + classify EVERY returned address. Null when fetchable.
 */
export async function isBlockedFetchUrlResolved(raw: string, opts: GuardedFetchOptions = {}): Promise<string | null> {
  const fast = isBlockedFetchUrl(raw);
  if (fast) return fast;
  const verdict = await assessProviderUrl(raw, {
    blockPrivate: true,
    resolve: activeResolve(opts),
  });
  if (verdict.allowed) return null;
  // assessProviderUrl words reasons for the provider-URL context; reword the
  // one that names it so agent/ingest errors read correctly. Graceful if the
  // upstream text ever changes: the original still shows.
  return (verdict.reason ?? 'blocked').replace('custom providers', 'fetched pages');
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/**
 * Fetch with per-hop SSRF guarding. Follows redirects manually (up to
 * FETCH_GUARD_MAX_REDIRECTS) and DNS-checks each Location BEFORE requesting
 * it. Intermediate bodies are cancelled to free the socket. Returns the
 * final non-redirect Response for the caller to consume.
 */
export async function fetchGuarded(
  url: string,
  init: RequestInit = {},
  opts: GuardedFetchOptions = {},
): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= FETCH_GUARD_MAX_REDIRECTS; hop++) {
    const blocked = await isBlockedFetchUrlResolved(current, opts);
    if (blocked) throw new Error(hop === 0 ? blocked : `redirect target blocked: ${blocked}`);
    const res = await fetch(current, { ...init, redirect: 'manual' });
    if (!isRedirect(res.status)) return res;
    const location = res.headers.get('location');
    try {
      await res.body?.cancel();
    } catch {
      // Best-effort socket release; the hop is abandoned either way.
    }
    if (!location) return res;
    let next: string;
    try {
      next = new URL(location, current).toString();
    } catch {
      throw new Error(`redirect target blocked: not a valid URL (${location.slice(0, 120)})`);
    }
    current = next;
  }
  throw new Error(`too many redirects (over ${FETCH_GUARD_MAX_REDIRECTS})`);
}
