# OMNIPIX — Performance & Reliability Audit

## 1. Startup

`index.ts`: config → safety net → restore+`initDb` (migrations + secret
probe) → `loadBundledCatalog` (signed ≥550-row apply, skipped when current)
→ declarative config → cache load → cooldown GC → proxy restore → `createApp`
→ listen → 11 schedulers + wake-detect [R][P0]. Desktop mirrors via
`server-host.ts` (contract test) [P0]. Slow-start risks: first-boot
migration + catalog apply; health/catalog deferred (10s boot delay) [R].

## 2. Build outputs

server `tsc` → `dist/`; client/studio `tsc -b` + vite → hashed `dist/`;
desktop esbuild → `build/` + electron-builder DMG/ZIP (+blockmaps); Docker
multi-stage node:24 (native rebuild, prune). Root builds server+cli+client+
studio [R]. Parent-measured: studio bundle ~430KB JS (icon tree-shaking
verified); `/Applications/OmniPix.app` 291MB [P0].

## 3. Hot paths & resource use

1. Catalog apply: hundreds of prepared statements in one tx (boot + 12h).
2. Embeddings: sequential per-row failover, 30s timeouts, strict validation.
3. Agent loops: ≤25 steps × 3 attempts + compactions, each a full
   router+fallback call, plus per-run learning distillation.
4. Fusion: 4–8 parallel calls + judge stream.
5. Proxy hot path: sync SQLite log per attempt, penalty Maps, 25MB body
   buffering, sharp image normalize.
6. Health pass: N keys × validate, concurrency 8, 1s provider spacing.
7. Response cache LRU 5000 + O(n) semantic scan per miss.
8. Bounded Maps (sticky/reasoning 500/1000, cache 5000, log ring 1000,
   per-key dispatchers 32) [R].

## 4. Bottlenecks (measurable improvement targets)

| # | Bottleneck | Evidence | Recommendation | Measure |
|---|------------|----------|----------------|---------|
| 1 | Sync SQLite on event loop + per-request sync writes | WAL fsync history comment; logRequest tx | Keep batching; move analytics writes off-request or batch window | p99 proxy latency under concurrent load |
| 2 | 25MB body buffering at 2–3× transient | config.ts | Stream/shrink vision path; lower default; reject oversize early | RSS during concurrent vision replays |
| 3 | Serial failover worst case | 20 hops, 45s budget | Cap hops/timeouts per profile; hedge slow first byte | p99 failover latency |
| 4 | Single-process memory state | Maps listed above | Persist sticky/penalties or document single-process scope | state survival across restart |
| 5 | Stale catalog → dead chains | 24-hop chains, MODEL_NOT_FOUND limit | Freshness guard + chain self-heal | dead-chain rate |
| 6 | Unbounded admin lists | keys/models/memories/… | limit/offset everywhere | list latency at 10k rows |

## 5. Reliability & recovery

Graceful shutdown (8s grace, idle drain); keep-alive tuning; wake-detect
re-probe; reconcile-orphans fail-loud at boot; backup-before-update;
pre-restore snapshots; durable monthly/hourly ledgers survive pruning [R].
Single-process scope means SSE listeners, runs, and penalties reset on
restart (GAP-ARCH-02) [R].

## 6. Testing & QA summary (for §10)

- Server: **474 files, 5957 passed / 6 skipped** on Node v22.23.3
  (parent-run 2026-11-20; one earlier run showed 4 timing flakes, clean on
  re-run). Child smoke on Node v20 failed on better-sqlite3 ABI mismatch
  (native module built for newer Node) — environment coupling, not
  assertion failures [P0][R].
- Client ~87, desktop 19 (incl. boot-mirror contract [P0: green]), CLI 13,
  **studio 0** [R][P0].
- Integration: 1 file; no e2e/load/fuzz/security suites beyond feature
  tests (error-handler, CSP, SSRF-guard, throttle, scans) [R].
- Parent live-verified (this session): Ollama chat+streaming, agent run on
  local model, file-watch auto-fire, one-click connect, boot catalog apply
  (561/50), Studio pages via headless screenshots [P0].
- Untested: premium backend, Windows desktop, feed hosting, provider-key
  live calls (no paid keys used), load/fuzz/chaos.
