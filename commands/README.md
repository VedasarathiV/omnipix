# File commands + agents

Slash commands and agent presets as markdown, resolved live from disk
on every run (no import step, edits apply immediately).

Layout (next to the skills dirs):

```
<config>/
  skills/                 M1 auto-discovery
  commands/review.md      /review <args>
  commands/deploy/staging.md   /deploy/staging <args>
  agents/reviewer.md      --agent reviewer
```

Config dirs: `~/.config/omnipix`, `~/.codex`, ancestor `.omnipix`
folders, and parents of `OMNIPIX_SKILLS_DIR` entries. Later dirs win
name clashes.

## Command format

```md
---
description: What it does (required).
agent: reviewer      # optional preset below
model: auto         # optional
---
Template with $1..$N ($ARGUMENTS for all input).
```

- `$N` takes the Nth word; the last placeholder greedily takes the rest.
- Input with no placeholders appends to the template.
- No `!shell` auto-execution by design: the agent runs shell via the
  `shell_exec` tool behind approvals. Subagents come from the
  `delegate` tool, which file agents may include.

## Agent format

```md
---
description: Read-only reviewer (required).
skills: code-review-checklist
tools: read_file, git_diff
model: auto
planMode: false
---
```

Explicit request fields (body `skills`/`tools`/`model`/`planMode`,
CLI flags) always win over the preset. Unknown names fail the run
with `Unknown agent: <name>.`

Copy this folder's examples to start:

```bash
mkdir -p ~/.config/omnipix/{commands,agents}
cp commands/*.md ~/.config/omnipix/commands/
cp agents/*.md ~/.config/omnipix/agents/
```
