# opencode architecture research (anomalyco/opencode, desktop 2.3.2)

Source: cloned repo at /tmp/opencode-ref + mounted DMG
(`opencode-desktop-mac-arm64.dmg`, `ai.opencode.desktop`, Electron +
embedded `opencode-cli` server binary, electron-updater).

## 1. How opencode is built (layers)

```
desktop (Electron shell) ──spawns──▶ opencode-cli (background service)
     │                                      │
     │ renders                        ┌─────┴──────────────────┐
     │                                │ server (HTTP API + WS) │
     │                                └─────┬──────────────────┘
     │                                ┌─────┴──────────────────┐
     │                                │ core: session/tool/    │
     └──── TUI/SDK ◀── subscribes ───▶│ agent/plugin/MCP/bus   │
                                      └────────────────────────┘
```

- **One server, many faces.** The CLI (`opencode-cli`) IS the product:
  TUI, desktop, `opencode run`, `opencode api`, ACP server, and web
  `serve` are all clients of the same background service. Sessions live
  in the server, so desktop/CLI/web can attach to the same run.
- **OmniPix parity: YES, already.** Our Electron app hosts the Node
  server on :31415; CLI/dashboard attach over HTTP. Same shape.
- **Effect-TS core.** Sessions, permissions, tools, bus are Effect
  modules (`packages/core/src/*`). Ours is plain async/await +
  better-sqlite3 — simpler to hack, same capabilities.

## 2. Sessions (their runs)

`packages/core/src/session/`: affinity, background(+result), blob,
command, **compaction**, context, diff, environment, error, event,
execution, generate, history, inbox, info, instructions, message…

- Session = persistent thread: messages, tool calls, diffs, todos,
  background jobs, compaction checkpoints. Survives restarts (SQLite).
- **OmniPix parity: YES.** `agent_runs` + `agent_steps` + conversations
  + checkpoints + `compactions` cover the same ground. Naming differs
  (`runs` vs `sessions`) — ours also has user `sessions` grouping runs.

## 3. Tools

Core tools (read/write/edit/bash/grep/glob/todo/webfetch/websearch) +
`packages/session-ui/src/tools/*` renderers (tool-group, file-runs,
shell-output state machines) + MCP tools + plugin tools.

- **OmniPix parity: MORE.** 39 native tools incl. browser ×5, office ×4,
  firecrawl ×4, git ×6, blackboard, skills, MCP. Tool trace UI exists in
  runs panel; inline chat trace is the remaining gap (research doc §1).

## 4. Permissions (their approvals)

`packages/core/src/permission*`: action/resource/effect rulesets with
wildcards, per-agent rules, ask/allow/deny, unattended rules,
saved permissions, `Declined/Corrected/Blocked` errors, macOS
case-insensitive path matching.

- **OmniPix parity: CONCEPTUAL.** `agent-policy.ts` (tiers) +
  approvals inbox + hooks + `autoApprove` + content-guard. Their
  wildcard rules (`bash: git * → allow`) are nicer than our tiers —
  candidate Phase-B adoption, NOT ported (would rewire every gate).

## 5. Commands, agents, skills, plugins

- `/command` files, subagents, `AGENTS.md` repo conventions, plugin
  system (`packages/plugin*`), MCP servers, scheduled automations.
- **OmniPix parity: YES.** `commands/` + `agents/` + `skills/` packs,
  subagents, hooks, MCP, automations, learning loop. No plugin SDK —
  our skills/commands cover the use cases without one.

## 6. Terminal (theirs vs ours)

opencode IS a terminal app: no terminal emulator inside — it shells out
(`packages/core/src/shell/*` + permissions) and renders output as tool
results, plus `opencode-cli` for scripting.

- **OmniPix decision (correct for a desktop app):** a real Terminal tab
  in the bottom panel (`/api/terminal/exec` + cwd), PLUS agent
  `shell_exec` with the same guards. Visible terminal beats TUI-only
  for our users; adopted their guard idea (destructive patterns denied),
  skipped rebuilding a PTY (exec-per-command is enough + testable).

## 7. CLI surface (adopted pattern)

Their CLI: `serve`, `run`, `session`, `api`, `auth`, `mcp`, `plugin`,
`models`, `stats`, `acp`, `pair`, `service`, `doctor`-equivalents.
Ours (`omnipix`): agent setup + keys + doctor + launch.

- Adopted next (no UI impact): `omnipix status|models|run|sessions`
  against the local gateway. (Queued — user said finish asked items
  first; then build.)

## 8. Branding (from the shipped DMG)

- Name "OpenCode", bundle `ai.opencode.desktop`, `hello@opencode.ai`,
  homepage opencode.ai, `icon.icns` + tray set, `app-update.yml`
  (electron-updater, same as ours), `apple-touch-icon` set.
- Takeaways applied: consistent product naming everywhere (done),
  updater pointed at our releases (done), dock/tray/client logo
  unification (done). Missing vs them: public homepage/docs URL —
  needs a domain decision, not code.

## 9. What we deliberately do NOT take

- Effect-TS rewrite (no user value, huge risk).
- ACP server (Zed-protocol niche; our MCP server covers editors).
- Plugin SDK (skills/commands/hooks cover it).
- Visible browser tab (biggest missing piece vs Codex, not vs opencode
  — opencode has none either; Phase C).
- Their exact permission schema (conceptual parity is enough).

## 10. Scorecard after adoption

opencode subsystems → OmniPix: server-attached clients ✅, sessions ✅,
tools ✅ (+more), permissions ~ (conceptual), commands/agents/skills ✅,
MCP ✅, automations ✅, compaction ✅, checkpoints ✅, evals ✅,
terminal ✅ (visible tab + agent shell), TTS/STT ✅ (they lack it),
multi-provider router ✅ (they lack it — single-key BYOK).
