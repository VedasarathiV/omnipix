# OmniPix changelog

## 0.2.1

Rebuilt on the current upstream base, with every OmniPix system carried over:
the workbench shell is back (sidebar + bottom panel, no top nav), Chat is the
landing page, and the Premium page is gone.

### Interface
- Workbench shell: VSCode-style activity bar, contextual sidebar (recent chats,
  model/keys/analytics links, folder opener), collapsible bottom panel with
  Logs, Health, Terminal, and Files tabs (Cmd/Ctrl+J).
- One sidebar on Chat: the page rail hides on desktop where the workbench
  sidebar already lists chats; refined title strip, mic pill placement.
- Nav order Chat → Agents → Models → Keys → Analytics; wider content column.
- Chat: code pane (Claude-style second column), read-aloud + auto-speak,
  @-mentions over ingested docs, /slash skills, agent handoff, folder picker
  with project-tree context, model dropdown in the chat header, prominent
  send button, no-keys starter CTA. Voice Test disables with guidance when
  no audio route exists instead of erroring.
- Agents: Connect catalog plus Runs, Hooks, Skills, Approvals, MCP, Groups,
  and Assistant (memories, docs, automations, scans) tabs.
- Arena model comparison, notification bell, no-keys banner, voice + egress
  settings sections, content-guard and semantic-cache controls, global
  dictation, command-palette deep links. Keys page untouched by design.

### Backend
- Agent runtime: runs, sessions, approvals, hooks, groups/crews, skills
  (14-ship pack + superpowers), MCP servers, automations, webhooks,
  notifications, memories/docs ingest, checkpoints, runbooks, learning loop.
- Browser + office tools, Firecrawl cloud tools (scrape/map/crawl/extract,
  key-gated), arena evals, content guardrails middleware, media probe + PDF
  upload parsing, local Ollama status/connect/pull API, terminal exec,
  file browsing, diagnostics bundle, keys GET-single/pagination/id hardening.
- Standalone by default: no catalog phone-home, no update repo, empty
  premium/storefront URLs — every feed is opt-in via env.

### Verification
- Server 6000+ tests, client 600+, desktop 100+, CLI 180+ — all green.
- Live-verified on the installed app: chat, models, skills, agents, Ollama.
