# OMNIPIX — Product Overview

Audit date: 2026-11-20. Evidence legend: **[P0]** = parent-verified by direct
read/run this session · **[R]** = research-child evidence (bodies inspected;
6/6 highest-severity claims spot-checked by parent).

## 1. What exactly is OmniPix?

OmniPix is a **local-first, single-user AI gateway and agentic coding platform**.
One sentence from its own README: *"One OpenAI-compatible endpoint over dozens
of free LLM providers"* [R: README.md:3-7]. It aggregates free-tier and custom
LLM endpoints (chat, embedding, image, audio, search, decisions) behind a
single `/v1` API with AES-encrypted key storage, best-model routing, 429/5xx
failover, and per-key usage tracking — and layers a coding-agent workspace
(chat + runs + approvals + diffs + terminal), multi-agent teams, skills, MCP,
evals, automations, voice I/O, and a CLI on top [R].

It is a **personal standalone MIT fork of FreeLLMAPI**, offline-capable
[R: README.md:11-15].

## 2. Problem solved

Developers who cannot afford (or do not want) per-seat AI subscriptions must
otherwise juggle ~87 provider SDKs, rate limits, keys, and billing pages by
hand. OmniPix stacks an estimated **~10.1B tokens/month across 736 model
families / 1,313 endpoints** behind one bearer token and one dashboard
[R: README.md:47-53]. Secondarily, it solves the "chat-only copilot" gap: its
agent runtime edits code, runs commands, runs tests, and asks approval —
locally, with any provider or with keyless local Ollama models
[P0: live-verified gateway→Ollama chat, streaming, and agent runs, 2026-11-19].

## 3. Primary purpose

Be the **provider-independent local AI platform**: any OpenAI-compatible client
(SDK, CLI agent, IDE plugin) points at `localhost:3001/v1` and gets routed,
fail-overed inference; the human drives deeper work through the Studio
workspace UI or the native desktop app [R][P0].

## 4. Target users

1. **Developers** pointing any OpenAI SDK/CLI at a local endpoint (documented
   Python `auto` / `auto:fast` / `auto:smart` profiles) [R: README.md:252-268].
2. **Coding-agent users** of ~20 external tools (Claude Code, Codex CLI,
   Cursor, Cline, Roo, OpenCode, Aider, +15 more) via one-command
   `setup-<tool>` generators [R: README.md:91-119, cli/README.md].
3. **Cost-sensitive builders** who want agent/IDE capability free via API-key
   free tiers or local Ollama [P0: Local Ollama one-click connect + keyless
   agent runs verified].

Explicitly **not** multi-user teams: single-user by design, no tenant
isolation [R: README.md:190].

## 5. Core use cases

| # | Use case | Entry point |
|---|----------|-------------|
| 1 | Chat/completions across 50+ providers with auto-failover | `POST /v1/chat/completions` model `auto`, Studio chat, CLI |
| 2 | Agentic coding (Ask/Plan/Agent modes, approvals, diffs, revert) | Studio, desktop app, `/api/agents/*` |
| 3 | Multi-agent teams with shared workspace, blackboard, QA loop | Teams tab, `POST /api/agents/groups`, runbook presets |
| 4 | Scheduled + file-watch automations with review-first gate | Automations tab, cron + `watch_json` triggers [P0] |
| 5 | Model evals / arena comparisons with judges | Evals page, `/api/arena/*` |
| 6 | Voice dictation + read-aloud | Voice page, mic, `speakText`/`transcribeAudio` |
| 7 | Key management: add/test/rotate/import/export/probe custom endpoints | Providers page, `/api/keys/*` |
| 8 | Usage analytics, budgets, health, logs | Analytics/Logs/Settings, `/api/analytics/*` |
| 9 | MCP: consume external servers + serve OmniPix tools to other agents | Skills/MCP UI, `/mcp`, `/api/mcp/*` |
| 10 | Wire any external coding tool to the gateway in one command | `omnipix setup-<tool>` CLI |

## 6. Value proposition

One `omnipix-` bearer token; self-updating signed model catalog (free
30-day-delayed snapshot; premium live feed advertised $19/yr or $49 lifetime)
[R: README.md:216-250]; dashboard + analytics; 60-locale admin UI
[R: README.md:192-214]; runs anywhere Node 20+ (~40MB RSS); keys stay
AES-encrypted in local SQLite [R].

## 7. Complete workflow (happy path)

1. Install → claim dashboard (setup) → add provider keys and/or connect local
   Ollama (one click) [P0].
2. Chat in Studio (Ask) or start an Agent run; approve/deny risky tool calls;
   review diffs; accept/revert; commit from UI.
3. Launch teams from runbook presets for parallel work; schedule automations
   (cron or file-watch) after one reviewed manual run.
4. Monitor tokens/cost/health in Analytics; rotate/reveal keys as needed.
5. External tools (Claude Code, Codex…) consume the same gateway via CLI
   setup generators or `/v1` directly.

## 8. Long-term potential

Credible path to "self-hosted AI platform": personal agent OS (scheduled
crews + memory + voice), team gateway appliance (needs multi-user/RBAC —
absent by design), eval-driven model ops, marketplace for skills/runbooks.
Biggest unlocks are trust gaps (Studio UI honesty), secure-by-default
hardening, and declaring one canonical UI (see Gap Analysis GAP-DOC-03).

## 9. Unresolved product questions

- Which frontend is canonical — `client/` admin dashboard or `studio/`
  workspace? (Shipped UI differs by build target [R].)
- Is premium/licensing ($19/yr, $49 lifetime) real or aspirational? Feed key
  was rotated 2026-11-20; no hosted feed URL is configured by default [P0].
- Windows/Linux desktop quality: admitted "largely untested" [R].
- The 87/736/1,313 marketing counts vs 63 adapter files vs 561 shipped
  catalog rows: counting method is undocumented [R][P0].
