# OmniPix — Testing (Hardening Track)

## Current state (parent-verified 2026-11-20)

- Server: **475 files, 5971 passed, 6 skipped** (`npx vitest run
  --pool=forks --fileParallelism=false`, Node v22.23.3).
- `tsc --noEmit` + `eslint` clean on all Sprint 1 touched files.
- Desktop boot-mirror contract green (5/5, earlier session).
- Studio: 0 tests. Integration: 1 file. No e2e/load/fuzz suites.
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
