# OMNIPIX — Backend & API Audit

Mount source: `server/src/app.ts` L277-419 [R]. Auth: `requireAuth`
(dashboard session) vs `requireInferenceAuth` (unified/`sk-cp-*`) vs open.

## 1. Inference surfaces (unified key unless noted)

| Endpoint | Method | Purpose | Validation / notes |
|----------|--------|---------|--------------------|
| `/v1/models`, `/codex/models`, `/models/:id` | GET | List / Codex-format / one (300-char cap, 404 typed) | `?available\|connected\|ready\|execution_status` |
| `/v1/usage` | GET | Monthly ledger (unified-only; 403 for profile/URL-token) | — |
| `/v1/chat/completions` | POST | Chat; idempotency-key, compression, fusion, cache, fallback loop | zod `chatCompletionSchema`, path-qualified 400s |
| `/v1/completions` | POST | Legacy completions | zod |
| `/v1/embeddings`, `/rerank` | POST | Embeddings / rerank | zod |
| `/v1/search`, `/search/engines` | POST/GET | Web search, engine list | query zod max 400 |
| `/v1/decisions`, `/v1/systemone` | POST | Decisions (same handler; legacy alias) | `DecisionBody` zod, Retry-After errors |
| `/v1/decisions/models` | GET | Decision models | bare array |
| `/v1/images|videos/generations`, `/audio/speech|transcriptions` | POST | Media (auth-before-multer on transcription) | file caps |
| `/v1/messages`, `/messages/count_tokens` | POST | Anthropic wire | header-negotiated `/models` |
| `/v1/responses` | POST | Codex wire | 422 on computer-use/image |
| `/v1/moderations` | POST | Moderation | `{model?,input}` zod |
| `/v1beta/models`, `:generateContent`, `:streamGenerateContent`, `:countTokens` | GET/POST | Gemini wire (+`?key=` hatch w/ warn) | Google error shape |
| `/mcp` | POST/GET/DELETE | MCP server (9 tools); enabled-gate before auth | JSON-RPC errors |
| `/api/tags|version|show|chat|generate|embed|embeddings` | GET/POST | Ollama emulation (own 3-mode gate) | non-OpenAI error shape |
| `/v1/t/:token/*` | * | URL-token proxy (re-mounts proxy+responses+ollama) | own limiter |
| `/v1/docs`, `/openapi.json` | GET | OpenAPI viewer (open, cached 1h) | — |
| `/livez`, `/readyz`, `/api/ping` | GET | Liveness (open) | — |

## 2. Admin API (`/api/*`, `requireAuth`)

**Keys/models/routing** — `keys.ts` (2045L): providers, list, cooldown/checkin
delete, export (password + 10rpm), reveal (60rpm), add (incl. keyless),
custom discover/probe/add, import/preview/import-selected, delete, platform
+ single PATCH. **Missing `GET /:id`** [R][P0: grep-confirmed]. `models.ts`:
strict create, custom delete, PATCH, DELETE (tombstone), test, list.
`fallback.ts`: quota-forecast, routing GET/PUT, penalty-inspector,
chain GET/PUT, sort presets, token/rate-limit usage. `profiles.ts`: full
CRUD + active + reorder + reset + per-profile sort.

**Agents** — runs (create 202 fire-and-forget, review, list ≤100, search ≤50,
proposals accept/discard, checkpoints, files/content/diff/revert, git
status/commit/branch, search, async exec, stop/resume, SSE events),
sessions, approvals (+rules CRUD, decide), groups (tasks|auto|preset,
runbooks, stop/resume/delete/blackboard), hooks CRUD, security scans.

**Content/services** — skills (CRUD+export/import), memories (+ingest,
docs sync/search/delete), automations (CRUD + run-now 202/409),
conversations, client-profiles (+rotate), notifications, logs (lenient
filters + clear), cache stats/config/clear, compression stats/preview,
embeddings (GET, custom add, PUT, custom delete, usage — **no POST /**,
P0-confirmed), media (list/usage/probe/custom/PUT/delete), search engines
(status/engines/test/enable), decisions (models/try), analytics (9
breakdowns; requests paginated ≤500 + row detail), health (status,
per-key check, check-all, quota, model probe).

**Platform** — diagnostics bundle, free-tier summary, backups (tables/
schedule/list/create/download/restore/delete), update (release/check/
status/apply 202), premium (status/key/delete/sync/portal; 404 when
build-disabled), ~20 settings GET/PUT pairs (+api-key regenerate, proxy
test), auth (status/desktop-session/setup/login/logout/me/change-email/
change-password/forgot/reset), local-ollama (status/connect/pull),
webhooks (events/list/create/delete/test — **no GET/:id or PATCH**),
outbound MCP (servers CRUD/test/tools/call).

## 3. Middleware

Host guard (opt-in, first), proxy 120rpm + admin 600rpm IP limiters (+tight
export/reveal), error handler (413 normalization, prod masking), content
guard (off default; inbound block/redact; **outbound redacts `res.json`
only — SSE unredacted**), doubled-`/v1` collapse, CORS allowlist, helmet
CSP + hashed bootstrap, HSTS off (documented local-HTTP choice), no
cookies (Bearer ⇒ low CSRF) [R].

## 4. Consistency findings

- Error `type` on ~52% (inference always; admin mostly not — GAP-API-05).
- Success shapes vary; PUT-vs-PATCH mixed; ID params mostly `:id`
  (`:keyId`, `:tool`, `:name`, `:preset` exceptions) [R].
- Zod `safeParse` pervasive on inference; manual int checks on `:id`;
  strict-vs-passthrough varies by router [R].
- Pagination on 5 lists only; everything else unbounded (GAP-API-08).
- Idempotency: non-streaming chat only; admin POSTs retry-unsafe
  (GAP-API-07). No per-key inference quotas (GAP-API-09).
- ~30 shipped endpoints have zero non-test references incl. the 3
  `local/ollama` routes the Studio card actually calls (dead-listing is
  `client/`-relative — Studio consumes some; see GAP-API-06) [R].

## 5. Missing / unnecessary

Missing: `GET /api/keys/:id`, webhooks GET/:id+PATCH, dashboard
`POST /api/embeddings` (or fix the ownership comment). Unnecessary/
overlapping: `/api/auth/me` vs `/status`, `/v1/systemone` alias (keep as
legacy), suspected `*/sort/:preset` (dynamic-use unverified) [R].
