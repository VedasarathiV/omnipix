# OmniPix — Engineering Audit (Hardening Track)

Date: 2026-11-20. Status: **Phase 1 complete; Sprint 1 in progress.**
Companion: `docs/audit/*` (11 discovery reports + executive summary, same date).

## Recon method

Six parallel read-only researchers (300 inspection calls, file:line evidence)
+ parent spot-verification of every HIGH claim + parent live runs (suite,
boot, Ollama, screenshots). No source modified during recon.

## Dependency map (verified)

- Inference: `routes/proxy|anthropic|responses|gemini|mcp|ollama` →
  `services/router.ts` + `lib/fallback-loop.ts` → `providers/*` registry →
  `lib/proxy.ts` undici fetch. State: router Maps, sticky sessions.
- Admin: `routes/*` (~46) → `services/*` → `db/index.ts` better-sqlite3.
- Agents: `routes/agent-*` → `agent-runtime` (25 steps) / orchestrator (DAG,
  3 parallel) → same router + `agent-tools` + approvals + workspaces.
- Catalog: bundled snapshot (`generated/`) + optional signed feed →
  `catalog-sync.applyCatalog` (tx) → `models` + chain rows.
- Frontends: `studio/` (shipped) + `client/` (legacy admin) → `/api` +
  `/v1`; `desktop/` embeds server via `server-host.ts` (mirror-tested);
  `cli/` drives live gateway APIs.

## Classified findings

### Critical

- **SEC-01**: `lib/fetch-guard.ts` is DNS-blind (literal checks only,
  parent-read). Agent `fetch_url` + docs ingest follow redirects, then
  re-check with the same blind guard — metadata/internal reachable via DNS.
  Fix: DNS-resolving guard + manual redirect loop + metadata deny.

### High

- **UI-01/02/03**: Studio onboarding exits at step 0; message/terminal
  actions toast-only (copy writes nothing; "Applied to src/auth/session.ts"
  hardcoded); chips/slash/@-mentions decorative (parent-read).
- **TEST-02**: better-sqlite3 ABI coupling breaks DB tests on Node mismatch
  (child-observed on Node 20; suite green on Node 22.23.3, parent-run).
- **DOC-03**: dual frontend, canonical choice undocumented; build target
  decides shipped UI.

### Medium

SEC-02 (SSRF TOCTOU residual), SEC-03 (unified key plaintext), SEC-04 (shell
denylist bypassable + allow rules silence tier), SEC-05 (MCP exec no
allowlist), SEC-06 (`::` default bind), API-01/02/03 (keys/:id, webhooks
edit, embeddings POST 404), API-08 (pagination), DB-01/02 (plaintext cache +
unified key), UI-04/05/06 (desktop bridges, mobile rails, timeline/diff
correctness), ARCH-01/02/03 (event-loop SQLite, memory state, stale catalog),
TEST-01 (studio 0 tests, no e2e/load/fuzz).

### Low / info

SEC-07/08/09/10, API-04/05/09/10, DB-03/04/05, UI-07/08/09, DOC-01/02/04.
Details + file refs: `docs/audit/OMNIPIX_GAP_ANALYSIS.md`.

## Sprint 1 scope (this session)

SEC-01, SEC-06 (loopback default + explicit docker `HOST=::`), SEC-09
(codes out of queryable buffer), SEC-04-part (denylist expansion + tests),
SEC-05-part (MCP spawn audit logging; full allowlist needs product approval
— breaks existing MCP configs). SEC-03 (unified-key hashing) **deferred for
explicit approval**: it changes credential retrieval semantics (display →
rotation flow). Each fix: reproduce → root-cause → smallest fix → tests →
suite → docs.
