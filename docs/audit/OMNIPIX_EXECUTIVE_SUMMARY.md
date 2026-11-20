# OMNIPIX — Executive Summary

Audit date: 2026-11-20 · Method: 6 parallel read-only research agents
(300 tool calls, bodies inspected) + parent spot-verification of all
highest-severity claims + parent live test runs. Full evidence in
`OMNIPIX_*.md` (this folder).

## What OmniPix actually is

A local-first, single-user **AI gateway + agentic coding platform**: one
OpenAI-compatible endpoint over 50+ free/custom providers (561 catalog
models), with smart routing and 429/5xx failover — plus a coding-agent
workspace (chat, runs, approvals, diffs, terminal), multi-agent teams,
skills, MCP, evals, automations, voice, CLI, and a native Electron desktop
app. Personal MIT fork of FreeLLMAPI.

## What has been built / works

- Inference core: OpenAI/Anthropic/Codex/Gemini/Ollama/MCP wires, bandit
  router, 20-hop fallback loop, cache, idempotency, budgets — **live-verified**
  incl. keyless Ollama chat, streaming, and agent runs.
- 63 provider adapters; signed catalog pipeline with bundled snapshot
  (fresh boots: 561 models / 50 platforms, chain-complete) — live-verified.
- Agents: runs/sessions/approvals/teams/hooks/scans, checkpoints, runbooks,
  cron + file-watch automations with review-first gate — live-verified.
- Admin API (~46 routers), CLI (~20 tool setups), analytics, backups,
  retention, AES-GCM key store, 474-file server suite (**5957 green**).
- Studio UI renders live data end-to-end (pixel-verified); desktop app
  installs and runs natively.

## What is incomplete / missing

- **Studio honesty gaps (verified)**: onboarding exits at step 0, message
  actions are toast-only, context chips/slash commands never sent.
- **API gaps**: no `GET keys/:id`, no webhook edit, dashboard embeddings
  POST 404s, ~30 unreferenced endpoints, 5/ N lists paginated.
- **Security**: 1 HIGH (DNS-blind SSRF), 5 MEDIUM (TOCTOU, plaintext unified
  key, shell denylist, MCP exec, `::` default), 4 LOW.
- **Docs**: stale READMEs, dual-frontend ambiguity, fork placeholders.
- **Tests**: studio 0, integration 1, no e2e/load/fuzz; Node-ABI coupling.
- **Unverified**: premium backend, Windows desktop, feed hosting, paid-key
  live calls.

## What should be improved / built next

1. Fix the HIGH SSRF + secure-by-default (`::`, Host guard, codes in logs).
2. Repair or remove Studio's dishonest UI (onboarding, toasts, chips).
3. Declare the canonical UI; align build targets.
4. Complete the admin API (keys/:id, webhooks, embeddings, pagination).
5. Encrypt/hash remaining plaintext secrets (unified key, cache).
6. Studio tests + one e2e + load smoke; pin Node ABI.

## Five biggest technical risks

1. SSRF via DNS-blind fetch guard (agent/docs paths reach metadata).
2. Single-process sync-SQLite + in-memory state (loss on restart; stalls).
3. Exposure fragility (`::` + opt-in guard + volatile lockouts + plaintext key).
4. Drift: desktop/index.ts mirror, dual UI, stale-catalog dead chains.
5. Test/env fragility (0 studio tests, ABI-coupled DB suite, no e2e/load).

## Five biggest product opportunities

1. One canonical UI + unified builds (ends shipped-UI confusion).
2. Studio truthfulness pass (highest visible UX win).
3. Admin completeness (keys/webhooks/embeddings/pagination/quotas).
4. Secure-by-default hardening (makes LAN/desktop safe to recommend).
5. Test/build stabilization (stops env-breaks-everything).
