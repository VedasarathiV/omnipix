# Moved

This page now lives at **[docs/en/architecture/00-high-level-index.md](en/architecture/00-high-level-index.md)** (中文: [docs/zh-cn/architecture/00-high-level-index.md](zh-cn/architecture/00-high-level-index.md)).

---

# OmniPix — Architecture, Hardening Track (2026-11-20)

> The canonical architecture narrative lives at the link above. This
> section records the hardening track's declared boundaries and deltas.

## Declared UI boundary (Sprint 2 decision, closes GAP-DOC-03)

- **studio/ is the shipped UI.** All four `desktop:dist*` targets build it;
  `stage-client.mjs` stages `studio/dist`; the packaged app serves it.
  Guarded by `desktop/src/__tests__/dist-targets.test.ts`.
- **client/ is the legacy admin dashboard** (19 routes, 60 locales). Kept:
  root `build` + `test` still cover it, root `dev` and `desktop:dev` still
  serve it (dev mode loads `repoRoot/client/dist`). Not shipped in desktop
  packages. No new workflows go here; no deletion (tests + deep-admin
  reference value).

## Current module responsibilities

- **server/**: Express gateway. Inference (`/v1`, `/v1beta`, `/mcp`,
  Ollama emulation) under unified-key auth; admin (`/api/*`, ~46 routers)
  under dashboard sessions; SQLite persistence; 11 in-process schedulers.
- **studio/**: agent-workspace UI shipped in the desktop app (chat, runs,
  approvals, diffs, terminal, providers, evals, voice). Live data layer;
  every control verified to have a working backend or explicit refusal
  (Sprint 5).
- **client/**: legacy admin dashboard — see boundary above.
- **desktop/**: Electron shell embedding the server (`server-host.ts`
  mirrors `index.ts`, contract-tested) + tray/popover/updater.
  Notable: desktop LAN toggle rebinds its embedded server to 0.0.0.0 —
  explicit, persisted, tray-driven; consistent with the loopback default.
- **cli/**: operator tooling driving live gateway APIs.
- **shared/**: types-only contracts.

## Data flow (verified)

`routes → services → getDb()`; inference `router → cache → fallback-loop →
providers → undici`; agents reuse the router with approval parking. Details:
`docs/audit/OMNIPIX_TECHNICAL_ARCHITECTURE.md`.

## Hardening-track deltas (Sprints 1–6)

- Sprint 1: new leaf module `lib/guarded-fetch.ts` (DNS guard + redirect
  loop); `fetch-guard.ts` stays pure per `module-purity.test.ts`. Default
  bind is loopback; Docker sets `HOST=::` explicitly. Log buffer gained
  an explicit suppression scope (`withoutLogBuffer`).
- Sprint 2: shared `formatKeyRow` (keys list + single); `getWebhook` /
  `updateWebhook`; shared `lib/pagination.ts` (opt-in envelope).
- Sprint 3: `RouteResult.decision` + `summarizeRoutingDecision()`; `why=`
  on selection trace events. No algorithm or wire-format change.
- Sprint 4: abort observed after model calls + before each tool;
  `traceAgentEvent()` execution tracing. State vocabulary unchanged.
- Sprint 5: `lib/compose.ts` pure message-composition helpers shared by
  InputBar/MessageBubble; ref-mirrored hash writers in the store.
- Sprint 6: studio vitest runner + `e2e/journey.mjs`; no architecture change.
