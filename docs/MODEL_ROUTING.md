# OmniPix — Model Routing (Hardening Track)

Status: **current-state record. Routing-intelligence improvements are
Sprint 3 scope — nothing below is changed yet.**

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
