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

## 2026-11-20 — Sprint 4 (agent runtime, this session)

- Stale-op guards: abort observed after model calls + before each tool in
  a turn; mid-call stops execute zero tools and reject answers.
- `traceAgentEvent()` execution tracing (tool start/ok/denied/error +
  run-finish; names only, no args).
- Kept state vocabulary (stopped = operator cancel); documented mapping.
- 3 lifecycle tests; full suite 479 files / 5992 passed (1 unrelated
  beforeEach quiesce-timeout flake under load; file green standalone).
- tsc + eslint clean.

## 2026-11-20 — Sprint 5 (Studio honesty, this session)

- Onboarding: real 3-step tour (keys → modes → agents), Back/Next/Get
  started; fake folder picker removed.
- Message actions real: clipboard copy, delete (PUT), branch (POST prefix
  + switch), edit (truncate + editDraft into box). Removed apply-to-file
  and checkpoint buttons (no backing data); removed dead `checkpoint` field.
- Chips resolve doc content on send (docs/search per chip, goal-then-title
  query, honest no-match blocks); real chunk counts replace fake tokens.
- Slash: /clear executes, /plan switches mode, /test /fix /commit expand
  to full prompts; /explain dropped (no selection exists).
- Attach: real file picker — text inserts fenced content (100KB cap,
  binary rejected); images → vision parts in Ask mode only (blocked with
  explanation elsewhere); array-content rendering in bubbles.
- Terminal copy writes the real clipboard; Settings "Save changes" → "Done".
- Found + fixed via verification: setConversationId never synced the hash
  (cleared chats reopened on reload) — ref-mirrored hash writers now.
- Verified: tsc + build green; 15/15 headless interaction checks
  (tour/copy/delete/branch/edit/attach//clear against live scratch stack);
  server suite 479/5993 green (1 unrelated load flake, green on re-run).

## 2026-11-20 — Sprint 6 (QA, this session — track complete)

- Studio vitest 5 runner (`npm test`) + `lib/compose.ts` pure helpers
  extracted from InputBar/MessageBubble (slash parse, keywords,
  chip context, content render) + 5 unit tests.
- `studio/e2e/journey.mjs` (`npm run test:e2e`): self-contained CDP
  journey, 20/20 green incl. live Ollama chat with chip context.
  Caught + fixed 2 real bugs: chip title-fallback query (AND semantics),
  mode reset on reload (script now sets Ask explicitly).
- `server/src/scripts/load-smoke.ts`: 200 reqs, 0 failures,
  p50 112ms / p99 187ms.
- Verified: studio tsc+build+unit green; server 479/5993; e2e green.

## 2026-11-20 — Approved follow-ups (this session)

- **SEC-03**: unified key sealed at rest with AES-256-GCM (same mechanism
  as provider keys) via boot-time `encryptUnifiedKeyAtRest` (migrations
  run pre-key-init, so no migration could do it). Chose AES over hashing
  deliberately: hashing would break URL-token injection, MCP self-calls,
  and Studio/CLI retrieval, demanding session-auth on /v1 + pipeline
  extraction; AES fixes the finding (offline DB theft) with zero ripple.
  4 tests; live-verified (triplet on disk, retrieval works).
- **SEC-05**: MCP stdio command allowlist — common-runtimes default
  (npx/node/python3/python/uvx), operator list via new
  GET/PUT `/api/settings/mcp-allowed-commands` (null resets, [] denies
  all), enforced at registration AND every spawn. 7 tests; live-verified
  (/bin/sh → 400, npx → 201).
- Full suite: **481 files, 6007 passed**; tsc + eslint clean.

## Track status: COMPLETE (Phases 1–12, Sprints 1–6 + approvals)

All queued approvals taken up. Deferred with rationale: DB-03 new FKs
(needs per-install orphan audit), Windows desktop parity, premium
backend reality check.

## 2026-11-21 — Opencode parity M1 + I1 (this session)

- **M1 file-first skills**: `services/skills-sync.ts` scans
  `~/.config/omnipix/skills`, `~/.codex/skills` (compat),
  ancestor `.omnipix/skills`, then `OMNIPIX_SKILLS_DIR` (low→high
  precedence) via new `scanSkillFiles` (`skill-files.ts`, depth ≤ 6,
  skips .git/node_modules); boot sync + `fs.watch` refresh (500 ms
  debounce, automation-watch shape + test hooks), hooked in
  `index.ts` onReady. Provenance column `skills.source_path`
  (migration `20261121_000027_skill_source`, registered in
  `migrate/defaults.ts`): builtins never touched, file-managed rows
  update on edit and delete when the file goes; dashboard rows
  untouched; bundle validation + `agency-` dedupe mirror the routes.
  13 new tests (scan 3, sync 10); live drop→appear probe green.
- **I1 one-line install**: new `install.sh` (docker default via local
  `compose up -d --build` — no published image needed; `--cli` via
  `npm install -g` from the GitHub checkout; node ≥ 22 gate, re-run
  safe, `--help`); `scripts/install.test.mjs` (6 tests) wired into
  `test:bootstrap`; `YOUR-GITHUB-USER` → `VedasarathiV` in 34 files
  (remote is the source of truth); bare `omnipix` already help+exit 0
  (verified). Still user-side: npm publish, omnipix.co hosting,
  Docker Hub push, GitHub release.

## 2026-11-21 — Opencode parity Q1–Q3 + M2 (this session)

- **Q1–Q3 skills pack**: 14 `skills/<name>/SKILL.md` ports from
  500-ai-agents-projects (every agent.py body read; prompts rewritten
  for OmniPix tools, no builtin collisions — `code-reviewer` port is
  named `code-review-checklist`); `skills/README.md` install guide
  (M1 auto-discovery: copy to `~/.config/omnipix/skills` or set
  `OMNIPIX_SKILLS_DIR`, or `skills import-dir`); 3 pack-validation
  tests (exact set, unique/valid names, no builtin shadow).
- **M2 file commands + agents**: `services/commands.ts`
  (`{command,commands}/**/*.md`, path-derived names, $1..$N with
  greedy-last + $ARGUMENTS + append rules, optional agent/model
  frontmatter) and `services/file-agents.ts`
  (`{agent,agents}/**/*.md` presets: skills/tools/model/planMode);
  resolved live from disk per run beside the M1 scan dirs (no DB,
  no sync lag); POST /runs expands leading /commands then applies
  presets under explicit fields (unknown agent → 400, preset typos
  fail via existing validators); CLI `agent run --agent NAME`;
  seed `commands/` (review, tests) + `agents/` (reviewer, coder) +
  README + 3 pack tests. Deliberate v1 limits: no `!shell`
  auto-exec (shell_exec + approvals instead), no session
  agent-switching (delegate tool covers subagents).
- UI research (opencode TUI bodies read): gap list U-G1..U-G6 —
  workspace @file finder, in-prompt @skill/@agent chips, file
  commands in / menu, palette fuzzy + skills/commands/settings
  entries (placeholder over-promises today), slimmer entry,
  discoverable keymap. Not built; queued as U1–U2.
- Suites: server 6053, cli 246 — all green.

## 2026-11-21 — U1–U2 core + upload/logo fixes (this session)

- **Upload**: images in agent/plan mode auto-switch to Ask with an
  info toast (was an error wall — the reported "can't upload");
  over-100KB text truncates with a loud notice instead of refusing;
  binaries/PDFs still honestly rejected (no PDF parser anywhere).
  Browser-verified across 5 attach cases.
- **Logo**: theme-aware mark (accent ring, fg core — was hardcoded
  emerald + invisible-in-light-mode white); spin → 1.6s pulse;
  splash screenshot-verified.
- **U1–U2**: GET /api/commands + GET /api/agents/presets (authed,
  live disk scans); / menu merges builtins + file commands +
  enabled skills; Ask mode expands /commands and inlines /skills
  client-side (agent/plan expand server-side); palette goes fuzzy
  (fuzzyScore + test) with Skills/Commands insert entries.
  5/5 browser probe green (menu, palette, expansion end-to-end).
- Journey updated for the image auto-switch; E2E 20/20 green.
- Web verdict (asked): agent runs browse via fetch_url (keyless,
  live-verified) + web_search (keyless Parallel/Keenable engines);
  Ask mode cannot (no tools by design); api-anything not needed.
