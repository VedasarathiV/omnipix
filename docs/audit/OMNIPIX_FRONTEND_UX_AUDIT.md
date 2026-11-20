# OMNIPIX — Frontend & UX Audit

Scope: Studio (`studio/`, shipped in the current desktop app [P0]) + desktop
shell (`desktop/src`). The legacy `client/` admin dashboard (19 routes, 60
locales) exists in parallel — canonical choice undocumented (GAP-DOC-03).

## 1. Navigation & shell

Rails: Chat, Agents, Skills, Provider keys, Models, Evals, Search, Docs,
Notifications, Voice (+Settings) with ⌘1–⌘0 [R][P0]. `AppShell`: TopBar
(run switcher, Ask/Plan/Agent, ModelPicker, status, Stop) + IconRail +
resizable sidebar/main/inspector + StatusBar (model/run/keys/bell) [R][P0:
pixels verified]. Traffic-light overlap fixed via `html.desktop` 78px pad +
drag region [P0]. Design tokens consistent (rounded-xl cards, 13px/11px-mono
meta, focus rings) [R].

## 2. Main workflows

- **Chat**: streaming SSE bubbles, token/cost header, plan heuristic; send
  paths for Ask vs Agent runs; sampling sliders + system prompt [R][P0].
- **Runs**: live timeline, approvals (Allow once/Always/Deny), checkpoints,
  diffs (split/unified, accept/revert), git commit/branch, exec terminal,
  files, logs [R][P0].
- **Teams/automations**: group create from presets, runbook list,
  automation CRUD + manual run + review gate + cron/file-watch [P0].
- **Providers/models**: 51 cards + Ollama connect/pull [P0], 561-row chain
  with strategies and reorder [P0].
- **Voice**: real MediaRecorder dictation + transcript + TTS sample; key-gated
  banner [P0]. **Evals/Search/Docs/Notifications**: wired tables/panels [R].

## 3. Verified-broken UI (parent-confirmed code reads)

1. **Onboarding exits at step 0** (`Onboarding.tsx:38` CTA calls `finish()`);
   "Open folder…" only toasts a fake confirmation (:45). No picker exists.
2. **Message actions are toast-only**: copy writes nothing (:12-16); "Applied
   to src/auth/session.ts" hardcoded (:36); Branch/Edit/Delete/Checkpoint
   toasts (:38-43). Terminal copy toast-only; attach toast-only; Settings
   "Save changes" toast-only (sections save individually).
3. **Context chips / slash / @-mentions decorative**: hardcoded token counts;
   `send()` transmits goal text only; `/clear|test|fix|commit` no-ops.

## 4. Other findings (research evidence)

- Timeline never shows running/pending, drops thought/plan/compact/tool_result/
  hook, resume fails silently; PlanCard local-only; DiffViewer index-pair
  misaligns on unequal hunks; Terminal exec pairs adjacent steps (fragile);
  PreviewPanel is a static placeholder; FileViewer is a plain textarea.
- Shortcuts ⌘N/⌘M/⌘Enter documented but unimplemented; two palette hints
  wrong (Search ⌘7 not ⌘6; Docs ⌘8 not ⌘7); Esc-in-input won't stop runs.
- Mobile: TopBar/StatusBar/IconRail dropped → rails unreachable; settings
  overflow; mic desktop-only.
- A11y: no focus trap/return/`aria-modal` on dialogs; hover-only actions;
  10–11px faint text contrast risk; icons lack `aria-hidden`; code fences
  stripped without markdown rendering.
- Approvals `cwd` hardcoded; `#/settings` renders ProvidersPage (duplicate).
- Desktop: zero `__OMNIPIX_*` bridge consumers in Studio (session-refresh,
  updater, dictation, login-item, version have no UI); theme never sets
  `data-theme-choice` (desync); no splash module in `desktop/src`.

## 5. States & feedback

Shared `EmptyState`, key/run/offline banners, pulse loadings, per-page empty
states, aria-live toasts (cap 4, 4s) — consistently implemented [R]. First-run
tour modal verified rendering [P0].

## 6. Recommendations (highest value first)

1. Make onboarding advance + wire/remove the folder picker (P0).
2. Implement or remove every toast-only action (P0).
3. Send chips/parse slash, or remove the chrome (P0).
4. Add `__OMNIPIX_*` consumers + theme choice (P1).
5. Timeline/diff/terminal correctness pass (P1).
6. Mobile rail nav + Stop/picker exposure (P1).
7. Shortcut truthfulness + focus traps + contrast (P2).
