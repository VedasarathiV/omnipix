# OmniPix — Testing (Hardening Track)

## Current state (parent-verified 2026-11-20)

- Server: **479 files, 5993 passed, 6 skipped** (`npx vitest run
  --pool=forks --fileParallelism=false`, Node v22.23.3).
- Studio: vitest 5 runner + 5 unit tests (`lib/compose`); `tsc -b` +
  `vite build` green.
- E2E: `studio/e2e/journey.mjs` (`npm run test:e2e`) — 20 checks green:
  setup, tour (forward/back/persist), providers, models, slash, attach,
  terminal copy, settings, Ollama connect, chip-context chat send,
  stream, persistence, restart recovery (model steps skip cleanly
  without a local daemon).
- Load smoke: `server/src/scripts/load-smoke.ts` — 200 requests,
  0 failures, p50 112ms / p99 187ms (local scratch server).
- Desktop 20 files / 101 passed (Sprint 2).
- `tsc` + `eslint` clean on all touched files, all sprints.
- Known env coupling: better-sqlite3 native ABI breaks DB tests on
  Node-version mismatch (observed on Node 20; green on Node 22).

## Sprint 1 tests added

- `__tests__/lib/guarded-fetch.test.ts` (11): DNS allow/block classes,
  metadata hostnames, NXDOMAIN fail-closed, literal fast path,
  resolver hook, redirect following/guarding/loop/invalid/init-forwarding.
- `log-redaction.test.ts` (+2): buffer suppression + code secrecy.
- `workspace.test.ts` (extended): 17 denied / 5 allowed command shapes.
- `mcp-servers.test.ts` (+1): spawn audit line + secret absence.
- Resolver stubs added to docs-ingest + memories route tests (no real DNS).
- `config.test.ts`: loopback-default assertion (contract change = the fix).

## Sprint 6 queue

Studio unit tests, one e2e journey suite (startup→onboarding→chat→agent→
terminal→restart), load smoke, guard fuzzing, Node/ABI pinning, CI wiring.
Live-verification log for this session: Ollama chat/stream/runs, boot
catalog apply (561/50), Studio screenshots, loopback bind line, DNS guard
live check.
