# OMNIPIX — Feature Inventory

Audit date: 2026-11-20. Status scale: **Verified** (live-tested this session)
· **Wired** (UI→route→service traced in code) · **Partial** (works with gaps)
· **Stale-doc** · **Missing** · **Broken**.

## Inference (server surface)

| # | Feature | Status | Frontend | Backend | Ext. deps | Tests |
|---|---------|--------|----------|---------|-----------|-------|
| F01 | OpenAI chat/completions + auto profiles + sticky/handoff + cache + compression + idempotency | Verified [P0: live Ollama chat+stream; suite] | Studio chat, client Playground | `routes/proxy.ts:47,1873`, `services/router.ts`, `lib/fallback-loop.ts`, cache, idempotency | 50+ providers | proxy-*.test ~30, router-*, cache |
| F02 | Embeddings / rerank / search / decisions (+`/systemone` alias) | Wired | client pages | `proxy.ts:860/895/935/979/1022-1069` | provider APIs | providers/*, routes/* |
| F03 | Image / video / speech / transcription | Wired | MediaModelsView, VoicePage | `routes/media.ts`, `services/media.ts` | provider media APIs | media tests |
| F04 | Anthropic `/v1/messages` + count_tokens + model negotiation | Wired | — (protocol) | `routes/anthropic.ts:487,1259,1298` | Anthropic wire | anthropic tests |
| F05 | Codex `/v1/responses` | Wired | — | `routes/responses.ts:681` | Codex wire | responses tests |
| F06 | Gemini `/v1beta` | Wired | — | `routes/gemini.ts:83,98,234-243` | Gemini wire | gemini tests |
| F07 | Ollama `/api/*` emulation | Partial (dashboard embeddings POST → 404, GAP-API-03) | Ollama clients | `routes/ollama.ts:85-607` | — | ollama tests |
| F08 | MCP server `/mcp` (ask_omnipix + 8 tools) | Wired | MCP clients | `routes/mcp.ts:431,593-708` | — | mcp tests |
| F09 | URL-token proxy `/v1/t/:token` | Wired | share links | `routes/url-tokens.ts:11-42` | — | url-token tests |
| F10 | Moderation `POST /moderations` | Wired, Stale-doc (doc says unsupported) | — | `routes/moderation.ts:25` | moderation models | moderation tests |
| F12 | Fusion virtual model (panel + judge) | Wired | FusionPage | `services/fusion.ts` | N models | fusion tests |
| F24 | Router / fallback (20-hop, 45s) / budgets / catalog-sync / health schedulers | Verified [P0: failover 13/13 vs freellmapi parity] | Models page chain | router, fallback-loop, ratelimit, catalog-sync | — | router-*, fallback-loop-*, health-* |
| F25 | 63 provider adapters + 561 catalog rows / 50 platforms | Verified [P0: boot-apply live] | Providers/Models pages + logos | `providers/*`, `services/bundled-catalog.ts`, feed pipeline | provider APIs | provider tests (50), bundled-catalog (4) |

## Management (admin UI + API)

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| F11 | Client dashboard (19 routes) | Wired | Playground→Premium; every page → mounted route [R] |
| F13 | Arena runs/evals/suites/scorecards | Wired, Partial (debates/verify/guard/import endpoints unreferenced) | `routes/arena*.ts` |
| F14 | Keys CRUD + health/cooldown + import/export/reveal/rotate + custom discover/probe | Wired, Missing `GET /:id`; 200-vs-201 inconsistency | `routes/keys.ts` (2045L) |
| F16a | Skills / memories / automations (cron+file-watch [P0 Verified]) / conversations / profiles / notifications / logs / cache / compression | Wired | webhooks missing GET/:id+PATCH |
| F16b | Webhooks (outbound, HMAC) | Wired, Partial (no edit/disable; no inbound) | `routes/webhooks.ts`, `services/webhooks.ts` |
| F17 | Analytics (9 breakdowns + requests) | Wired | only paginated list; rest unbounded (GAP-API-08) |
| F18 | Health / quota / free-tier / backups / update / premium / settings / auth | Wired, Partial (dead settings pairs; premium backend unverified) | see Backend audit |

## Agents & teams

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| F15 | Agent runs/sessions/approvals/groups/hooks/scans + SSE | Verified [P0: live run on local model; approvals inbox; checkpoints] | `routes/agent-*.ts`, `services/agent-runtime.ts` (25 steps), orchestrator (3 parallel) |
| F20 | Studio workspace (8 pages + shell) | Partial — many UI stubs (GAP-UI-01/02/03/06/07/08/09) | live data layer verified [P0]; interaction stubs listed in UX audit |
| F21 | Desktop app (tray/popover/updater/dictation) | Partial — zero `__OMNIPIX_*` consumers in Studio; no splash module | `desktop/src/*`; boots + serves verified [P0] |
| F22 | Voice dictation/transcription/speech | Partial — VoicePage mic rewired real [P0]; needs audio keys; mic permission per-platform | `studio/src/lib/voice.ts`, VoicePage |
| F19 | CLI (~20 setup generators + ops) | Wired | live-catalog driven; 13 test files |

## Persistence & platform

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| F23 | Migrations (~80) / backups / retention / AES-GCM key store | Wired, Partial (plaintext unified key + response cache; missing FKs) | `db/*`; roundtrip tests |
| F10b | Local Ollama one-click (detect/connect/pull) | Verified [P0: live daemon v0.40.16] | `routes/local-ollama.ts`, Providers card |

## Not implemented / broken

- **Broken**: Studio onboarding flow (exits at step 0), toast-only message
  actions, decorative context chips/slash commands [P0-verified code reads].
- **Missing**: `GET /api/keys/:id`, webhooks edit/disable, dashboard
  `POST /api/embeddings`, per-key inference quotas, SSE PII redaction,
  studio tests, e2e/load/fuzz suites.
- **Unverified**: premium license backend, Windows desktop, feed hosting
  (default empty; bundled snapshot ships instead [P0]).
