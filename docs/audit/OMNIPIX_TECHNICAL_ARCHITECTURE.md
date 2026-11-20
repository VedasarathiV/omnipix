# OMNIPIX — Technical Architecture

## 1. Stack

TypeScript ESM monorepo, Node ≥20.18 <25. Server: Express 5, helmet, CORS,
compression, multer, sharp, undici, zod. Client/Studio: React 19 + Vite +
Tailwind (+ TanStack Query). Desktop: Electron 38 + esbuild + electron-builder.
CLI: TS + vitest. DB: better-sqlite3 (node:sqlite on Android path)
[R: package files; db/index.ts:32-47].

## 2. Architecture diagram

```
┌─────────┐  ┌────────┐  ┌────────────────────┐  ┌──────────┐  ┌───────────┐
│ client/ │  │studio/ │  │desktop (Electron)  │  │  cli/    │  │ ext. SDKs │
│ admin   │  │workspace│  │tray+popover+window │  │ setup/*  │  │ /agents   │
└───┬─────┘  └───┬────┘  └────────┬───────────┘  └────┬─────┘  └─────┬─────┘
    │ HTTP/SSE  │ HTTP/SSE       │ embeds (server-host.ts) │        │ /v1 wire
    └───────────┴────────────────┴─────────────────────────┴────────┘
                              ▼
                    server/src/app.ts:createApp
   ┌──────────────┬───────────────┬────────────────┬───────────────┐
   │ /v1 proxy    │ /v1beta,/mcp  │ /api/* admin   │ static, liveness│
   │ unified key  │ proto auth    │ session auth   │ open          │
   └──────┬───────┴───────┬───────┴────────┬───────┴───────────────┘
          ▼               ▼                ▼
   router→cache→fallback-loop→providers→undici/SOCKS→provider APIs
   services/* ──► getDb() better-sqlite3 (WAL, FK, AES-GCM secrets)
   11 in-process schedulers (health/catalog/cooldown/automation/…)
```

## 3. Request lifecycles

**Chat completion** (most important): body-limit parsers (25MB inference /
10MB rest) → contentGuard → client-context ALS → compression → cache
(exact SHA-256 LRU + semantic trigram tier) → bandit `routeRequest` → up to
20 serial fallback attempts (45s wall budget) → per-attempt `logRequest`
(requests + hourly aggregates + budget alerts) [R].

**Agent run**: `POST /api/agents/runs` (202, fire-and-forget) →
`executeAgentRun` (≤25 steps × 3 attempts, ≤32 tools, 2 verify rounds) → tool
loop over the same router with approval parking, SSE events, checkpoints,
learning-loop distillation [R]. Teams: orchestrator DAG, 3 parallel, roles,
blackboard, file locks, QA guardrails [R][P0: presets verified].

**Boot**: config → safety net → restore+`initDb` (migrations) →
`loadBundledCatalog` (signed snapshot ≥550 rows) → declarative config →
cache load → cooldown GC → proxy restore → `createApp` → listen → 11
schedulers + wake-detect [R][P0]. Desktop mirrors via `server-host.ts`
(contract enforced by `server-host-boot.test.ts`) [P0].

## 4. Cross-cutting design

- **Auth**: 3 separated schemes — dashboard session (Bearer), inference
  (unified or `sk-cp-*` key), open (ping/livez/docs); Ollama 3-mode gate;
  URL tokens inject Bearer + flag [R].
- **Errors**: pure classifiers (`isRetryableError`, transport/auth/quota/
  provider-level), per-error cooldown ladder (402/403→day, daily→midnight),
  413 normalization, prod 5xx masking, 240-char provider-error redaction [R].
- **Logging**: `console.*` → redaction wrapper → 1000-ring buffer + rate-capped
  SQLite warn/error persist; prompts never logged [R].
- **State**: single-process Maps (penalties, sticky sessions, SSE listeners,
  run controllers); reconcile-orphans fail-loud at boot [R].

## 5. Bottlenecks & risky decisions

1. Sync better-sqlite3 on the event loop + per-request sync writes [R].
2. Full 25MB body buffering at 2–3× transient per request [R].
3. Serial failover worst case (20 hops; 45s budget bounds it) [R].
4. In-memory state lost on restart; no multi-process story [R].
5. ~70 adapters + catalog-gated rows: stale catalog → dead chains [R].
6. Plaintext response cache when enabled [R].
7. Desktop must mirror `index.ts` (mitigated by mirror test) [R][P0].

## 6. Data-flow notes

Inference is stateless per request except cache/sticky/penalties/cooldowns;
admin is CRUD over SQLite with prepared statements throughout (768 call
sites audited: values parameterized, identifiers whitelisted/constant) [R].
Migrations run transactionally with a ledger; pricing applies every boot;
quirks reset-and-insert [R].
