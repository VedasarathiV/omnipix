# OmniPix — Model Routing (Hardening Track)

Status: **Sprint 3 implemented (2026-11-20).**

## What Sprint 3 found

Capability-aware filtering, eligibility gating, history-weighted scoring,
cooldowns/penalties, reliability floor, sticky/exploration/degraded handling
all **already existed and were tested** — no algorithm change was made
(per the do-not-replace rule). The verified gap was success-path
explainability: exclusion reasons existed only on the exhaustion path.

## What Sprint 3 added

- `RouteResult.decision: RoutingDecision` — strategy, reason
  (`preferred-model` | `exploration-probe` | `first-eligible` |
  `margin-deferred` | `tool-deferred`), rows considered, keyless-skipped
  count, and per-cause exclusion counters mirroring the diag lines.
- `summarizeRoutingDecision()` one-line form, emitted as `why=` on the
  per-attempt `start`/`next` trace events (proxy ×2, responses ×1).
  Wire format unchanged (`X-Routed-Via`, `_routed_via` untouched).
- 8 tests (`route-decision-explain.test.ts`); full suite green.

## How routing works today (verified from code + tests)

- `services/router.ts`: bandit scorer over chain candidates (reliability /
  speed / intelligence weights, strategies: priority/balanced/smartest/
  fastest/reliable/custom/decision), monthly budgets, weight overrides,
  endpoint scopes, quota headroom, sticky sessions.
- `lib/fallback-loop.ts`: up to 20 serial attempts, 45s wall budget,
  per-error cooldown ladder, auth-failure benches, truncation/empty
  streaks, provider-level skip, attempt trail headers.
- Decisions surface today: `_routed_via` block, `x-routed-via` style
  attempt headers, penalty inspector (`/api/fallback/penalty-inspector`),
  routing scores/strategy APIs.
- Failover core verified line-identical in behavior to freellmapi approach;
  13/13 failover tests green (parent-verified earlier session).

## Sprint 3 queue (from audit + phase spec)

Capability-aware filtering, eligibility gating, history-weighted scoring
(latency/reliability/cost/task fit), unsuitable-request suppression,
provider-failure isolation, decision recording + explainability
(provider/model/reason/capabilities/cost/latency/fallback) — all with
tests, no fabricated usage/pricing.
