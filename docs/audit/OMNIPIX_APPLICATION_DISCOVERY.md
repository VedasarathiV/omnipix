# OMNIPIX — Application Discovery

Audit date: 2026-11-20. Legend: **[P0]** parent-verified · **[R]** research evidence.

## 1. Repository layout

TypeScript ESM monorepo. Workspaces: `shared, server, client, cli, studio`
[R: package.json:4-10]; engines Node ≥20.18 <25. Top-level dirs: `cli`,
`client`, `desktop`, `docker`, `docs`, `examples`, `repo-assets`, `scripts`,
`server`, `shared`, `studio` [R].

## 2. Module purposes

| Module | Purpose | Key entries |
|--------|---------|-------------|
| `server/` | Express 5 gateway: inference proxy, admin API, agents, schedulers, SQLite persistence | `src/index.ts` boot, `src/app.ts` mounts (L277-419), `src/routes/*` (46 files), `src/services/*` (~70), `src/providers/*` (63), `src/db/*`, `src/lib/*` (~60), `src/middleware/*` |
| `client/` | Admin dashboard (React 19 + Vite + Tailwind + TanStack Query, 60 locales) | `src/App.tsx` lazy pages + 19 routes (L328-354), `pages/`, `components/` (~60), `i18n/locales` (60 JSON) |
| `studio/` | Agent-workspace UI (React 19, hash rails, English-only): chat-first IDE surface | `src/App.tsx` rail switch (L31-56), 8 pages, 30 components, `lib/api.ts` (`apiFetch`:50, `streamChat`:77), `lib/queries.ts`, `state/store.tsx` (11 rails) |
| `desktop/` | Electron menu-bar app embedding the server + dashboard | `src/main.ts` (DEFAULT_PORT=31415:19), `tray.ts`, `popover.ts`, `server-host.ts`, `preload.ts`, `updater.ts` |
| `cli/` | `omnipix` binary: tool setup generators, keys, agents, evals, doctor | `src/index.ts` (parseArgs:96, dispatch:677-708), `tools.ts` (tools:1174), `keys/doctor/models/scan/eval/guard/mcp/assistant` |
| `shared/` | Types-only contracts | `types.ts` (Platform union :63, key import types :10-54) |
| `scripts/` | Dev bootstrap + test | `dev-bootstrap.sh/.ps1/.test.mjs` |
| `docker/` | Multi-stage image (node:24-bookworm-slim, native rebuild, prune) | per arch child |

## 3. How the pieces communicate

```
client|studio|desktop-renderer --HTTP/SSE--> server/src/app.ts:createApp
  /v1 ......... inference (unified key)      proxy/anthropic/responses/moderation
  /v1beta ..... Gemini wire                  geminiRouter
  /mcp ........ MCP server (unified key)      mcpRouter
  /api/* ...... admin (dashboard session)    ~46 routers behind requireAuth
  /api/tags.. . Ollama emulation (own gate)  ollamaRouter at root
  / ........... static client/dist
```

Inference path: `requireInferenceAuth` → bandit `routeRequest` → exact+semantic
cache → 20-hop `runFallbackLoop` → provider registry → undici/SOCKS fetch;
per-attempt `logRequest` rows [R]. Admin path: `/api/*` → services → `getDb()`
better-sqlite3 sync connection (WAL, FK, busy_timeout, AES-GCM) [R].
Desktop embeds the same server via `server-host.ts`, bundled by
`scripts/bundle-server.mjs` [R].

## 4. Background jobs (all in-process)

Health checker (5m), catalog sync (12h), cooldown probe (60s), model probe
(30m), custom-model sync (24h), builtin discovery, automation scheduler (60s)
+ file watchers [P0], security scans (60s), DB backup pump (5m), backup
scheduler (60s), wake-detect [R: index.ts:93-103 + service files].

## 5. Configuration surface

`.env.example` standalone defaults (no feed/premium/update repo); `PORT`,
`HOST` (default `::`), `OMNIPIX_DB_PATH`, `DASHBOARD_ORIGINS`, `CATALOG_BASE_URL`
(empty default), `CATALOG_PUBKEY`, `ENCRYPTION_KEY` (required in prod),
`PROXY_RATE_LIMIT_RPM`, `REQUEST_BODY_LIMIT_MB` (25), `ALLOWED_HOSTS`
(opt-in), `TRUST_PROXY`, retention/quota tunables [R][P0].

## 6. Testing infrastructure

- server: 474 `__tests__` files (db 25, lib 87, providers 50, routes 169,
  services 140, integration 1, scripts 2) [R][P0: `find` count = 474].
- client ~87, desktop 19, CLI 13, **studio 0** [R][P0: no `studio/src/__tests__`].
- No e2e (playwright/cypress), load, or fuzz suites [R].
- Parent-verified: full server suite **5957 passed / 6 skipped** on Node
  v22.23.3 (2026-11-20); child-observed better-sqlite3 ABI failure on Node
  v20.19.6 (native module built for newer Node) [P0][R].

## 7. Duplication / inconsistency notes

- Two frontends overlap without a canonical declaration; build target
  decides which ships [R] (GAP-DOC-03). Parent note: current
  `/Applications/OmniPix.app` ships Studio [P0].
- Legacy `docs/providers/*.md` vs `docs/en/providers/*.md` parallel trees [R].
- Error `type` on ~52% of admin error responses; PUT-vs-PATCH mixed; success
  shapes vary (`{success}`, `{deleted}`, `{cleared}`, bare arrays) [R].
- `GET /api/auth/me` overlaps `/status`; quota-forecast/search-engines/
  decisions-models exist in both `/api` and `/v1` (mostly intentional
  dual-surface) [R].

## 8. Unknowns

- Premium/license backend reality (routes exist; hosted service unverified).
- Production deployment topology (docker-compose exists; no observed prod).
- Windows desktop behavior beyond "largely untested" [R].
