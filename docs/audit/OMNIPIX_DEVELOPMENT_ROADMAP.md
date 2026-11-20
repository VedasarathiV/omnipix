# OMNIPIX — Development Roadmap

Each phase lists what/why/modules/deps/acceptance. Essential vs optional
marked **[E]** / **[O]**.

## Phase 0 — Foundations: security + honesty (P0s)

- **[E]** GAP-SEC-01: DNS-resolving fetch guard + metadata-host tests.
  Modules: `server/src/lib/fetch-guard.ts`, agent-tools, docs-ingest.
  Accept: SSRF tests block DNS-private + metadata; redirects re-checked.
- **[E]** GAP-SEC-06: loopback default or Host guard on by default.
  Accept: fresh install not LAN-open, or guarded + documented.
- **[E]** GAP-SEC-09: codes/emails out of logs. Accept: `/api/logs` clean.
- **[E]** GAP-UI-01/02/03: onboarding that completes; real or removed
  actions/chips/slash. Accept: manual tour passes; clipboard writes;
  payload includes chips.
- **[E]** GAP-DOC-03: declare canonical UI; align `desktop:dist` targets.
  Accept: one documented UI decision; builds agree.
- **[E]** GAP-TEST-02: pin Node/ABI (engines + CI) or default node:sqlite.
  Accept: suite green on pinned Node; mismatch fails with a clear message.

## Phase 1 — Core functionality

- **[E]** GAP-API-01/02/03/04: `GET keys/:id`, webhooks GET/:id+PATCH,
  embeddings POST (or ownership fix), 201 consistency. Deps: none.
  Accept: 200/201s, int-id checks, tests.
- **[E]** GAP-DB-01/02 + SEC-03: encrypt cache rows (or keep-off + warn);
  hash/encrypt unified key. Accept: DB dump shows no plaintext secrets.
- **[O]** GAP-SEC-07: persist lockouts/codes; per-IP+email throttle.

## Phase 2 — Product experience

- **[E]** GAP-UI-04: consume `__OMNIPIX_*` bridges (session refresh,
  updater, dictation, version UI, theme choice). Accept: desktop session
  survives; updater visible; themes sync.
- **[E]** GAP-UI-06: timeline statuses + resume toast; diff alignment;
  terminal attribution; preview URL-or-remove. Accept: pixel-verified.
- **[O]** GAP-UI-05: mobile rail nav + Stop/picker.

## Phase 3 — Advanced capabilities

- **[E]** GAP-SEC-04/05: shell-allow scoping/expiry + UI surface; MCP
  command allowlist + confirm + audit log.
- **[O]** GAP-UI-07/08/09: shortcuts, focus traps, contrast, markdown.
- **[O]** GAP-API-06/07: dead-endpoint disposition + ref test; retry-safety.

## Phase 4 — Performance & scalability

- **[E]** GAP-ARCH-01: stream/shrink vision path; hop/timeout caps; load
  smoke in CI. Accept: bounded RSS + p99 under concurrent replays.
- **[O]** GAP-API-08/10: pagination expansion; SSE guard handling.
- **[O]** GAP-DB-03/04: FKs + tx races; GAP-ARCH-02/03: state persistence
  decision + catalog freshness guard.

## Phase 5 — Production readiness

- **[E]** GAP-TEST-01: studio unit tests + 1 e2e + load smoke + guard fuzz.
  Accept: all run in CI.
- **[O]** GAP-SEC-02/08/10, GAP-DB-05, GAP-DOC-04, GAP-API-05/09: TOCTOU
  pinning, password policy, retention/down docs, placeholder/README/Windows
  cleanup, error-type rollout, quota-scope decision.

## Suggested order of build

0 → 1 → 2 → 4(slim: ARCH-01+API-08) → 3 → 5. Rationale: trust and honesty
first (security + UI truthfulness), then completeness, then the perf items
that bite real usage, then hardening/polish last.
