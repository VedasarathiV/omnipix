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

## Next unfinished task

**Sprint 2 (core architecture)**: Studio/Client responsibility doc +
`GET /api/keys/:id` + webhooks GET/:id+PATCH + embeddings POST ownership
fix + pagination rollout start. After that: Sprint 3 routing observability,
Sprint 4 agent lifecycle, Sprint 5 Studio honesty fixes, Sprint 6 e2e.
Queued approval needed: SEC-03 unified-key hashing, SEC-05 full MCP
allowlist.
