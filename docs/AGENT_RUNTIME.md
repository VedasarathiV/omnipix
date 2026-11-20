# OmniPix — Agent Runtime (Hardening Track)

Status: **Sprint 4 implemented (2026-11-20).**

## What Sprint 4 added

- **Stale-op guards**: abort is now observed (a) after every model call
  (before tools execute or an answer is accepted) and (b) before each tool
  in a multi-call turn — a stop can no longer strand half a batch.
  Pre-existing checks (loop head, post-approval, verify gate) unchanged.
- **Execution tracing**: `traceAgentEvent()` one-line `[Agent]` log —
  `tool-start`/`tool-ok`/`tool-denied`/`tool-error` with seq + duration,
  `run-finish` with terminal status. Tool names only, never arguments.
- **States**: kept the existing vocabulary
  (`running`/`done`/`error`/`stopped`/`awaiting_approval`) — `stopped` IS
  operator cancellation; no new state (would ripple DB/UI for no gain).
- 3 lifecycle tests (mid-call abort executes zero tools; abort rejects
  answers; trace content/secrecy); full suite green.

## How the runtime works today (verified from code + live runs)

- `services/agent-runtime.ts`: ≤25 steps × 3 attempts, ≤32 tools,
  2 verify rounds; SSE event fan-out; stop/resume; checkpoints;
  skill select/slash; compaction at 24k pressure; orphan reconcile
  fail-loud at boot. Live agent run on a local model completed and was
  observed end-to-end (parent-verified).
- Tools (`agent-tools.ts`, ~28): calculator/time/web/fetch/memory/todo/
  files/grep/edit/shell/checks/blackboard/docs/skills/git/delegate.
  `fetch_url` now goes through the DNS-aware guarded fetch (Sprint 1).
- Policy (`agent-policy.ts` + `approval-rules`): risk tiers with human
  inbox; shell/approve-gated. `lib/workspace.ts`: cwd lock, env scrub,
  timeouts/caps, opt-in docker, denylist backstop (expanded Sprint 1).
- Orchestrator: task DAG, 3 parallel, roles, blackboard, file locks,
  QA guardrails, runbook presets, hierarchical mode.

## Sprint 4 queue

Explicit lifecycle states (pending/running/waiting-tool/completed/failed/
cancelled), least-privilege tool enforcement, cancellation + stale-op
safety, retry policies, history/tracing, context + resource limits,
interrupted-run recovery, approval-rule scoping/expiry UI.
