# OmniPix coding-agent research: what "advanced" actually needs

Date: 2026-11-23. Basis: opencode, ChatGPT Codex (IDE + CLI), Cline,
Aider, Continue, Cursor — measured against this repo (`~/Downloads/omnipix-new`).

## 0. The one-line model

A coding agent = **Chat + Code + Computer**, sharing one brain:

- **Chat** — ask, explain, plan. No side effects. Fast models OK.
- **Code** — read/edit/run repo code with tools. Needs repo context + approvals.
- **Computer** (multi-mode) — browser, terminal, files, docs, memory.
  Every extra mode multiplies usefulness, but only if context routing,
  approvals, and checkpoints stay correct.

Leaders all converge on: one input box, explicit **mode/picker**,
**context chips** (files, folders, docs, skills), **approvals inbox**,
**checkpoints/undo**, and a **tool trace** ("read files, ran command").

## 1. Interface (what the user touches)

| Need | Leader pattern | OmniPix status | Gap |
|---|---|---|---|
| Single composer | Codex "Do anything", opencode input | `liquid-composer.tsx` + header model dropdown | ✅ have |
| Mode picker (chat/code/plan) | Cline Act/Plan, Codex modes | Model dropdown only, no mode | ❌ **add: Chat / Code / Plan switch** |
| Context chips | Codex Xr11/Local/main chips | Attachment chips only | ⚠️ add folder + skill + branch chips |
| Tool trace in chat | Codex "Read files, ran a command" | Runs panel only, not inline | ❌ **add inline tool-call rows** |
| Diff view | Cline/Codex diff, "21 files +244 −88" | `diff-viewer.tsx` in runs panel only | ⚠️ surface in chat too |
| Approvals inline | Codex "Ask for approval" | Approvals tab (separate page) | ⚠️ inline approve/deny buttons |
| Checkpoints/undo | Cline checkpoints, Codex undo | `checkpoints.ts` service, runs UI only | ⚠️ one-click restore in chat |
| Sidebar explorer | Codex Files, opencode tree | Files bottom-panel tab (new) | ⚠️ promote tree into sidebar |
| Terminal tab | Codex Terminal | Bottom-panel Terminal (new) | ✅ have |
| Browser tab | Codex built-in browser | Headless agent tools only | ❌ visible browser = big build |
| Voice | — (nobody does this well) | Dictation + TTS + voice settings | ✅ ahead |

## 2. Context engine (what the model sees)

| Need | Leader pattern | OmniPix status | Gap |
|---|---|---|---|
| Repo map / tree | Aider repo-map, Cline context | Folder tree attach (72-file cap) | ✅ have, raise caps |
| @file @folder @code | Cursor/Cline mentions | @docs + attach-file row | ❌ **@file/@folder/@symbol mentions** |
| Docs ingest | Continue docs, Codex web | `/api/memories/*`, DocsPanel | ✅ have |
| Web fetch | Cline fetch, Codex browser | `fetch_url` + Firecrawl tools | ✅ have |
| Memories | Continue memory, Codex memory | `memories.ts` + recall tools | ✅ have |
| Skills/slash | opencode skills, Codex skills | `/api/skills` + `/slash` + 331 rows | ✅ have |
| Session continuity | Cline task continuity | Conversations + handoff to runs | ✅ have |
| Compaction | Cline/Codex summarize-and-continue | `compactions` in runtime opts | ✅ have (verify UI) |
| Token budget UI | Cline context window bar | Usage/analytics pages | ⚠️ per-chat context meter |

Biggest context win available: **@file/@folder/@symbol mentions** with
fuzzy finder over the opened folder (ripgrep-backed, like opencode).

## 3. Tools (what the agent can do)

Have today (`agent-tools.ts` + `firecrawl-tools.ts`, 39 tools):
calculator, time, web_search, fetch_url, memory ×4, read/grep/write/edit,
shell_exec, run_check, blackboard ×2, git ×6, delegate, recall_docs,
find_skill, todo, browser ×5, office ×4, firecrawl ×4.

| Need | Leader pattern | OmniPix status | Gap |
|---|---|---|---|
| Shell in repo | All (sandboxed) | `shell_exec` in run workspace | ❌ **run inside opened folder (workdir)** |
| File editing | All | In run workspace only | ❌ same workdir gap |
| Git ops | Aider git, Cline checkpoints | git_* in workspace | ❌ same workdir gap |
| LSP/diagnostics | opencode/Cline diagnostics | `diagnostics.ts` API, no UI surface | ⚠️ surface errors inline |
| Browser (agent) | Codex browser tools | Headless CDP, live-verified 3s | ✅ have |
| Browser (human tab) | Codex built-in browser | None | ❌ big build, Phase 3 |
| MCP servers | Cline MCP, Codex MCP | `/api/mcp/*` + McpPanel | ✅ have |
| Image understanding | Codex screenshots | `browser_screenshot` artifact | ✅ have |
| Test runner | Cline "run tests" | `run_check` + hooks | ✅ have |

The single most important backend gap: **runs execute in an isolated
run-workspace, never in the user's opened folder**. Codex/opencode/Aider
all execute in the repo. Fix = `workdir` column on `agent_runs` +
tool-root switch + "Run in folder" picker + approval default-deny for
writes outside. That one change turns the toy into the tool.

## 4. Execution, safety, trust

| Need | Leader pattern | OmniPix status | Gap |
|---|---|---|---|
| Approvals policy | Cline auto-approve settings, Codex approval modes | `agent-policy.ts`, approvals inbox, `autoApprove` flag | ✅ have |
| Plan mode | Cline Plan, Codex plan | `plan_mode` migration + runtime flag | ⚠️ expose toggle in composer |
| Checkpoints | Cline timeline | `checkpoints.ts` + restore API | ⚠️ chat-surface restore |
| Sandboxing | Codex sandbox, Docker | `OMNIPIX_SANDBOX=docker` + `workspace.ts` guards | ✅ have |
| SSRF/path guards | — (often missing elsewhere) | `fetch-guard`, `url-guard`, `resolveInRoot` | ✅ ahead |
| Evals/scorecards | SWE-bench, opencode evals | Arena + evals + scorecards UI | ✅ have |
| Prompt-injection marking | Spotlight (ours) | `spotlight.ts` boundary markers | ✅ ahead |

## 5. Models + routing (multi-version core)

Have: 394 models via unified key, fallback chains, fusion panel+judge,
decision router, Ollama local (`qwen2.5-coder:0.5b` live-verified),
DeepSeek ×11, model comboboxes everywhere.

| Need | Leader pattern | OmniPix status | Gap |
|---|---|---|---|
| Per-mode model | Cline per-mode models | One picker shared | ❌ remember model per Chat/Code/Plan |
| Thinking/reasoning toggle | Codex reasoning effort | Sampling params (temp/top_p) | ⚠️ effort selector |
| Cost/latency meter | Cline token/cost footer | Analytics pages | ⚠️ per-run cost chip |
| Offline local | Ollama in Cline/Codex | `/api/local/*` + emulation | ✅ have |

## 6. Multi-mode ("code, chat, and more") — the target shape

```
┌────────────────────────────────────────────────────────┐
│ [Chat ▾] [Code ▾] [Plan]   model ▾   folder ▾   skills │
│  transcript with tool trace + diffs + checkpoints      │
│  +  [Ask…]                    approves  mic  [send]     │
└────────────────────────────────────────────────────────┘
```

- **Chat mode**: answers only. Tools allowed: web/docs/memory/skills.
  Never touches files. Fast + cheap.
- **Code mode**: full tools in the opened folder. Writes need approval
  (default) or auto (toggle). Every run checkpointed.
- **Plan mode**: tool-free draft → approval → converts to Code run.
  (Runtime flag exists; needs the composer toggle.)
- Later modes reuse the same rails: **Browser** (visible tab),
  **Docs** (ingest + cite), **Review** (diff + comment).

## 7. Build order (priority = user-visible leverage / risk)

### Phase A — make folders real (this week)
1. `agent_runs.workdir` migration + tool-root switch + "Run in folder".
2. @file/@folder mentions (fuzzy finder over opened folder).
3. Inline tool trace + approve/deny in chat transcript.
4. Collapse long attachments (user bubbles stay readable).
5. Dedupe Settings (gear only on desktop).

### Phase B — mode system (next)
6. Chat/Code/Plan switch in composer + per-mode model memory.
7. Checkpoints restore button in chat.
8. Per-chat context meter + per-run cost chip.
9. Sidebar file explorer (promote Files panel tree).

### Phase C — big bets (later)
10. Visible browser tab (Electron webview + nav + cookie import).
11. LSP diagnostics inline (jump to error).
12. Firecrawl crawl scheduling + sitemap watch for docs.

## 8. What NOT to build

- Self-hosted Firecrawl stack (Redis/Postgres/Playwright cluster) —
  cloud API already integrated as a keyed provider.
- A second agent runtime — one runtime, three modes.
- Keys page redesign — frozen per user instruction.
- Premium/storefront — removed per user instruction.

## 9. Honest scorecard (today)

- Chat: 8/10 (needs modes + trace + @file).
- Code: 5/10 (all tools exist; blocked on workdir gap).
- Computer (browser/terminal/files): 7/10 (headless ✓, visible browser ✗).
- Memory/skills/docs: 9/10 (ahead of most).
- Safety/approvals/evals: 9/10 (ahead of most).
- **Overall: the engine is built; the steering (modes + folder execution
  + inline trace) is the remaining work.**
