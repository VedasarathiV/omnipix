# OmniPix — Security Hardening (Sprint 1)

Date: 2026-11-20. Scope: P0/selected-P1 security fixes. Each item: threat →
fix → files → verification.

## SEC-01: DNS-aware outbound fetch guard [FIXED]

- **Threat**: agent `fetch_url` + docs ingest used literal-IP checks and
  `redirect: 'follow'`; DNS names to metadata/internal hosts passed, and
  redirect targets were requested before any re-check.
- **Fix**: new `server/src/lib/guarded-fetch.ts` — `assessProviderUrl` with
  `blockPrivate: true` on every hop (DNS resolve + classify all addresses,
  metadata-host deny, fail closed on NXDOMAIN, 5s resolve timeout), manual
  redirect loop (max 5, bodies cancelled). `fetch-guard.ts` kept pure (purity
  test intact). Consumers: `agent-tools.ts`, `docs-ingest.ts`.
- **Verified**: 11 new tests (incl. redirect-to-private never requested);
  live DNS check (metadata blocked, public allowed, NXDOMAIN blocked);
  full suite green.

## SEC-06: loopback-by-default bind [FIXED]

- **Threat**: default `::` bind exposed a fresh install's login/setup to the
  LAN/internet with only in-memory limits.
- **Fix**: `lib/config.ts` defaults `HOST` to `127.0.0.1`; remote access
  requires explicit `HOST=::`. `docker-compose.yml` sets `HOST=::` (container
  needs it for port mapping; host publish stays loopback via `HOST_BIND`).
  Removed the dead 0.0.0.0 error fallback that would have silently widened
  exposure. Updated `.env.example` + setup-code comment.
- **Verified**: config unit test pins the default; live boot logs
  `Server running on http://127.0.0.1:3996`; suite green.

## SEC-09: one-time codes out of queryable logs [FIXED]

- **Threat**: setup/reset codes + account email were captured into the
  server-log buffer readable via `/api/logs` by any session holder.
- **Fix**: `withoutLogBuffer()` scope in `lib/log-redaction.ts`; used by
  `generateSetupCode` / `generateResetCode`. Terminal still receives the
  lines; buffer does not. Nest-safe, restores after.
- **Verified**: 2 new tests (buffer exclusion + terminal delivery + code
  secrecy); suite green.

## SEC-04 (part): shell denylist expansion [HARDENED]

- **Fix**: `lib/workspace.ts` patterns now deny `rm -r` on `/`, `/*`, `~`,
  `$HOME`/`${HOME}`, `--recursive`/`-R` spellings; `find / -delete`;
  `find -exec rm -r`; spacing-tolerant fork-bomb match. Real containment
  remains approval + cwd + scrub + caps + opt-in docker (unchanged).
- **Verified**: extended denylist tests (17 denied, 5 allowed incl.
  `rm -rf ./build`); suite green.
- **Residual**: denylist is a backstop by design; generalized
  `name() { …|…& }; name` fork bombs and novel spellings are not covered.
  Approval-rule scoping/expiry UI stays in Sprint 4/5.

## SEC-05 (part): MCP spawn audit trail [ADDED]

- **Fix**: `services/mcp-servers.ts` logs every stdio spawn at warn level
  (persisted tier): server name + command + arg count. Args/env never
  logged (they carry tokens).
- **Verified**: live-fake-server test asserts the line + secret absence.
- **Follow-up shipped**: full allowlist now enforced (see above).

## Approved follow-ups (implemented 2026-11-20)

- **SEC-03**: unified key AES-256-GCM sealed at rest (boot-time
  conversion, idempotent; legacy plaintext tolerated on read). Hashing
  was evaluated and rejected: it would break URL-token injection, MCP
  self-calls, and Studio/CLI retrieval, requiring session-auth on /v1 —
  disproportionate, since a live session already equals total compromise.
- **SEC-05**: full command allowlist shipped (default runtimes,
  operator-managed setting, registration + spawn enforcement).

## Still deferred (need product decisions)

- **SEC-07** (persist lockouts), **SEC-02** (connection-pinned DNS),
  argument-level MCP constraints (npx/python remain quasi-arbitrary —
  documented residual).
