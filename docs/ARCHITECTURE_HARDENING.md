# OmniPix — Architecture, Hardening Track

> Named `ARCHITECTURE_HARDENING.md` because `docs/architecture.md` already
> exists (pointer stub — left untouched).

Status: **current-state record (Sprint 1 done)**. Canonical responsibilities
and any restructuring land in Sprint 2; nothing here describes future work
as built.

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
  known honesty gaps (see audit GAP-UI-01/02/03) queued for Sprint 5.
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

## Sprint 1 architecture deltas

- New leaf module `lib/guarded-fetch.ts` (DNS guard + redirect loop);
  `fetch-guard.ts` stays pure per `module-purity.test.ts`.
- Default bind is loopback; Docker sets `HOST=::` explicitly.
- Log buffer gained an explicit suppression scope (`withoutLogBuffer`).
