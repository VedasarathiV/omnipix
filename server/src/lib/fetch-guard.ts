// SSRF guard for outbound fetches, shared by the fetch_url tool and docs
// ingest. Null when the URL is fetchable; otherwise the reason it is not.

const BLOCKED_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', '[::1]']);

export function isBlockedFetchUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'not a valid URL';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'only http(s) URLs are allowed';
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host)) return 'loopback hosts are not allowed';
  // IPv4 private/link-local/reserved ranges + IPv6 unique-local/link-local.
  if (/^(10|127)\./.test(host)
    || /^192\.168\./.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    || /^169\.254\./.test(host)
    || /^0\./.test(host)
    || host === '::1'
    || /^[fd][0-9a-f]{0,3}:/i.test(host)
    || /^fe[89ab][0-9a-f]:/i.test(host)) {
    return 'private-network hosts are not allowed';
  }
  return null;
}
