/**
 * Load smoke: hammers read-heavy admin endpoints concurrently and reports
 * latency + failures. No provider keys needed (dashboard session only).
 *
 * Usage (server running with a dashboard account):
 *   npx tsx src/scripts/load-smoke.ts --url http://127.0.0.1:3001 \
 *     --email op@example.com --password '...' [--n 50]
 *
 * Exit 0 when every request succeeds; exit 1 otherwise. Prints p50/p99.
 */
import { performance } from 'node:perf_hooks';

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (fallback !== undefined) return fallback;
  console.error(`missing --${name}`);
  process.exit(2);
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function main(): Promise<void> {
  const base = arg('url', 'http://127.0.0.1:3001').replace(/\/$/, '');
  const email = arg('email');
  const password = arg('password');
  const n = Math.max(1, Math.min(500, Number(arg('n', '50')) || 50));

  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!login.ok) {
    console.error(`login failed: ${login.status} ${await login.text().catch(() => '')}`);
    process.exit(2);
  }
  const { token } = (await login.json()) as { token: string };
  const headers = { authorization: `Bearer ${token}` };

  const paths = ['/api/models', '/api/keys', '/api/conversations', '/api/analytics/summary'];
  const latencies: number[] = [];
  let failures = 0;
  const jobs: Promise<void>[] = [];
  for (let i = 0; i < n; i++) {
    for (const path of paths) {
      jobs.push((async () => {
        const t0 = performance.now();
        try {
          const res = await fetch(`${base}${path}`, { headers });
          // Drain the body: latency must include transfer, not just headers.
          await res.arrayBuffer().catch(() => undefined);
          latencies.push(performance.now() - t0);
          if (!res.ok) {
            failures++;
            console.error(`FAIL ${path}: ${res.status}`);
          }
        } catch (err) {
          failures++;
          console.error(`FAIL ${path}: ${err instanceof Error ? err.message : err}`);
        }
      })());
    }
  }
  await Promise.all(jobs);
  latencies.sort((a, b) => a - b);
  const total = n * paths.length;
  console.log(
    `requests=${total} failures=${failures} ` +
    `p50=${percentile(latencies, 50).toFixed(0)}ms p99=${percentile(latencies, 99).toFixed(0)}ms ` +
    `max=${(latencies[latencies.length - 1] ?? 0).toFixed(0)}ms`,
  );
  process.exit(failures ? 1 : 0);
}

void main();
