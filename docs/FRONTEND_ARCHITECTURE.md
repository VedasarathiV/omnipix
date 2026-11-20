# OmniPix Frontend Architecture (Studio — the shipped UI)

Studio (`studio/`, React + Vite + TS + Tailwind) is the UI the desktop app
ships: `desktop/scripts/stage-client.mjs` copies `studio/dist` into the
packaged app, and the embedded gateway serves it. `client/` is the legacy
admin console, kept for dev/tests only.

## Layout contract: where / what / why

```
TopBar:  [workspace + branch] … [mode Ask|Plan|Agent] [model] [cost] [run/stop]
Rail | Sidebar (chats/files) | Chat + agent timeline | Right panel (inspector)
```

- **IconRail** (left, always visible): 10 destinations with ⌘1..⌘0 shortcuts —
  Chat, Agents, Skills, Provider keys, Models, Evals, Search, Docs,
  Notifications, Voice. The native Electron menu (`desktop/src/menu.ts`)
  mirrors these exactly; `studio/src/hooks/useNativeMenu.ts` subscribes to the
  receive-only `__OMNIPIX_MENU__` preload bridge (navigate / new-chat /
  open-settings). Unknown rail ids are ignored, never crash.
- **Sidebar**: contextual per rail (chat list, file tree). Collapsible,
  resizable, width persisted in localStorage.
- **Main**: chat transcript + live agent timeline (plan card, step cards,
  thinking blocks, approvals). Every message offers copy; conversation
  messages add delete / branch / edit-and-resend — all backed by
  `PUT/POST /api/conversations` (see `ChatView.tsx`).
- **Right panel** (Changes | Files | Terminal | Preview | Logs): the review
  surface. Auto-opens on first file change. Terminal runs real commands via
  `POST /api/terminal/exec` (workspace-jailed, owner-trust for absolute
  project paths); multiple sessions, copy/clear/kill.
- **Settings** live in a modal (`SettingsModal`), never a permanent panel.
- **Command palette** (⌘K): jump to files/chats/agents, switch model, run
  commands. **Toasts** + state banners surface errors with retry.

## State & data flow

- `state/store.tsx` (`StudioProvider`): rail, conversationId, activeRunId,
  mode, model, panel visibility, toasts. Location hash mirrors rail+chat+run
  so reloads and deep links reopen the same view.
- `lib/queries.ts` (React Query, no retries, 15s stale): conversations,
  runs (polled while active), approvals, skills, providers, usage.
- `lib/api.ts` (`apiFetch`): session-token fetch with dashboard auth.
- Streaming: chat completions stream into `streamingReply`; agent runs replay
  persisted steps via polling — reload-safe by construction.

## First-run & identity

`Splash` (logo + progress) → `AuthGate` → `Onboarding` (workspace, provider
key or local Ollama, model) → Chat. `Logo.tsx` is the single green-ring/white-dot
SVG used in Splash, IconRail, and AuthGate; `index.css` holds the spin
animation. No key yet → `KeyBanner` guides to Providers/Onboarding; the app
stays usable with local Ollama (keyless).

## Component map (one line each)

AppShell (resizable 3-pane grid) · TopBar (workspace/mode/model/cost/run) ·
Sidebar (chats/files per rail) · ChatView (transcript + timeline + approvals) ·
MessageBubble (copy/wrap/branch/edit/delete) · InputBar (attach/@/slash/mic/send,
prompt history, templates) · PlanCard/StepCard/RunTimeline (live run state) ·
ApprovalPrompt (allow once/always/deny with exact command) · RightPanel →
ChangesPanel/DiffViewer (split/unified, accept/revert per hunk/file),
TerminalPreview, PreviewPanel, Logs · ModelPicker (Auto fallback chain +
per-provider) · ProvidersPage (key add/test, status, fallback order) ·
AgentsPage/AgentEditor (instructions/tools/model/memory/permissions/test run) ·
SkillsPage · EvalsPage · SearchPage · DocsPage · VoicePage (dictation + TTS) ·
NotificationsPanel · CommandPalette · SettingsModal · MobileBar (single-column
+ bottom tabs under the mobile breakpoint).

## Rules for changes

1. Every control must have a working backend or a visibly disabled state —
   no decorative buttons (chat audit 2026-11: InputBar/ChatView/MessageBubble
   fully wired).
2. New rails: add to `types.ts` RailId, IconRail ITEMS, App MainPane,
   `useNativeMenu` set, AND `desktop/src/menu.ts` RAILS (same order/shortcuts).
3. Persisted UI sizes go through the `stored()` helper (private-mode safe).
4. No secrets in localStorage; session token rides the 0600 staged file
   (desktop) or dashboard session, never argv/URLs.
