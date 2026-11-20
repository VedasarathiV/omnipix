# OmniPix — Implementation Log (Hardening Track)

## 2026-11-20 — Phase 1 + Sprint 1 (this session)

- Wrote `docs/ENGINEERING_AUDIT.md` (recon record, dependency map, classified
  findings). No source touched.
- **SEC-01**: added `server/src/lib/guarded-fetch.ts` (DNS-aware guard +
  manual redirect loop); rewired `services/agent-tools.ts` (`fetchUrlText`)
  and `services/docs-ingest.ts` (`fetchCapped`); added
  `__tests__/lib/guarded-fetch.test.ts` (11 tests); stubbed resolver in
  docs-ingest + memories route tests. Verified: targeted 74/74, live DNS
  check, full suite green.
- **SEC-06**: `lib/config.ts` host default `::` → `127.0.0.1`;
  `docker-compose.yml` `HOST: "::"`; `.env.example` docs;
  `lib/setup-code.ts` comment; removed dead 0.0.0.0 fallback in
  `server/src/index.ts`; updated `config.test.ts` default assertion
  (contract change = the fix, per Phase 2.3 order). Verified: live boot
  bind line, suite green.
- **SEC-09**: `withoutLogBuffer()` in `lib/log-redaction.ts`; used by
  setup/reset code loggers; 2 new tests. Verified: suite green.
- **SEC-04p**: denylist expansion in `lib/workspace.ts` + extended tests.
  Verified: 13/13 workspace tests, suite green.
- **SEC-05p**: `auditStdioSpawn` in `services/mcp-servers.ts` (both spawn
  sites) + live-fake-server audit test. Verified: 6/6, suite green.
- Full suite: **475 files, 5971 passed, 6 skipped** (Node v22.23.3).
  `tsc --noEmit` + `eslint` clean on all touched files.
- Docs: `ENGINEERING_AUDIT.md`, `SECURITY_HARDENING.md`, this log, plus
  sprint-status stubs `ARCHITECTURE.md`, `MODEL_ROUTING.md`,
  `AGENT_RUNTIME.md`, `TESTING.md`.

## 2026-11-20 — Sprint 2 (core architecture, this session)

- Declared Studio the shipped UI; fixed `desktop:dist:mac:x64|win|linux`
  to build studio (they built client while stage-client stages studio —
  stale-bundle bug); `desktop:dev` intentionally still builds client
  (dev loads repoRoot/client/dist). Guarded by new
  `desktop/src/__tests__/dist-targets.test.ts`. Recorded in
  `ARCHITECTURE_HARDENING.md`. `client/` kept (build+tests+dev).
- **API-01**: `GET /api/keys/:id` via extracted `formatKeyRow` shared
  formatter (single-row output provably identical to list rows);
  route placed after literals (fixed a shadowing regression caught by
  export tests during verification). 2 tests.
- **API-02**: webhooks `GET /:id` + `PATCH /:id` (`getWebhook`/
  `updateWebhook`; secret replace/clear semantics). 1 test.
- **API-03**: investigated — no dashboard consumer POSTs /api/embeddings
  and a test pins the fallthrough-to-404 contract; resolved as
  by-design with corrected comments (ollama.ts, app.ts). No new endpoint.
- **API-08 start**: shared `lib/pagination.ts` (opt-in envelope, bare
  array default = backward compatible); wired to keys + models lists
  (561 rows). Unit + route tests.
- **DB-04**: auth writes transactional with UNIQUE→email_taken mapping;
  setup race → 409. 3 atomicity tests. DB-03 (new FKs) analyzed and
  deferred: needs per-install orphan audit before any migration.
- Full suite: **477 files, 5982 passed**; desktop 20/101; tsc + eslint
  clean. One self-caught regression (route shadowing) fixed same session.

## 2026-11-20 — Sprint 3 (AI infrastructure, this session)

- Mapped router: capability gates (vision/tools/structured/context/TPM),
  bandit/explore/sticky/degraded, cooldowns/penalties, floor — all present
  and tested. No algorithm change (per rules).
- Added success-path explainability: `RouteResult.decision` (strategy,
  reason, considered, keylessSkipped, 8 exclusion counters) +
  `summarizeRoutingDecision()` + `why=` on selection trace events
  (proxy ×2, responses ×1). Wire format untouched.
- 8 tests; live attachment check outside vitest.
- Full suite: **478 files, 5990 passed**; tsc + eslint clean.

## Next unfinished task

**Sprint 4 (agent runtime)**: lifecycle states, cancellation/stale-op
safety, tracing. Then Sprint 5 Studio honesty, Sprint 6 e2e. Approvals
still queued: SEC-03 unified-key hashing, SEC-05 full MCP allowlist.
