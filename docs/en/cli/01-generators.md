**English** · [简体中文](../../zh-cn/cli/01-generators.md)

# Setup generators

## Usage

```bash
npx omnipix setup-claude        # wire Claude Code
npx omnipix setup-codex         # wire Codex CLI
npx omnipix setup-dsh           # wire DeepSeek Harness
npx omnipix setup-mimo          # wire MiMo Code
npx omnipix setup-atomcode      # wire AtomCode
npx omnipix --dry-run setup-claude  # preview without writing
npx omnipix setup-claude --model gpt-4o  # pin a model
```

Before generating, `setup()` (`cli/src/index.ts`) fetches the live catalog — skipped for guide-only `setup-cursor`, which needs neither catalog nor key — and resolves `--model` against the unfiltered catalog (`c942352`). Every generator (`cli/src/tools.ts`) then backs up existing config with a timestamped copy, merges without clobbering unrelated keys, and writes files with `0600` for sensitive files (keys, tokens) and `0644` otherwise; sensitive-file backups are `0600` too.

## Generator table

| Command | Target file | Protocol | Notes |
| --- | --- | --- | --- |
| `setup-claude` | `~/.claude/settings.json` | Anthropic Messages | `ANTHROPIC_BASE_URL`/`AUTH_TOKEN`/`MODEL`, `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1`, `launch` zero-persistence launcher |
| `setup-codex` | `~/.codex/config.toml` | OpenAI Responses | `[model_providers.omnipix]` `wire_api=responses`, `launch-codex` launcher |
| `setup-cline` | `~/.cline/data/settings/providers.json` | OpenAI Chat | Cline VS Code extension |
| `setup-continue` | `~/.continue/config.yaml` + `~/.continue/.env` | OpenAI Chat | Continue ghost-text autocomplete |
| `setup-aider` | `~/.aider.conf.yml` | OpenAI Chat | Aider pair-programmer |
| `setup-opencode` | `~/.config/opencode/opencode.json` + key in `~/.local/share/opencode/auth.json` | OpenAI Chat | OpenCode agent (`$XDG_CONFIG_HOME` / `$XDG_DATA_HOME` override) |
| `setup-goose` | `~/.config/goose/custom_providers/omnipix.json` + `~/.config/goose/config.yaml` | OpenAI Chat | Goose agent |
| `setup-qwen` | `~/.qwen/settings.json` + `~/.qwen/.env` | OpenAI/Gemini | Qwen Code, `/v1` or native `/v1beta` |
| `setup-roo` | `~/.roo/omnipix.json` + `~/.roo/omnipix-cli.json` + `~/.roo/cli-settings.json` | OpenAI Chat | Roo Code |
| `setup-kilo` | `~/.config/kilo/kilo.jsonc` | OpenAI Chat | Kilo Code |
| `setup-crush` | `~/.config/crush/crush.json` | OpenAI Chat | Crush (charmbracelet) |
| `setup-dsh` | `$DSH_HOME/settings.yaml` + `$DSH_HOME/.env` (default `~/.dsh`) | OpenAI Chat | DeepSeek Harness (#995) |
| `setup-mimo` | `~/.config/mimocode/config.json` | OpenAI Chat | MiMo Code JSON `provider.omnipix` (`@ai-sdk/openai-compatible`, `{env:OMNIPIX_API_KEY}` substitution; `$MIMOCODE_HOME/config` override) (#1003) |
| `setup-atomcode` | `~/.atomcode/config.toml` | OpenAI Chat | `default_model=omnipix` + `[provider_accounts.omnipix]` + `[models.omnipix]`; preserves unrelated configuration |
| `setup-openclaw` | `~/.openclaw/openclaw.json` + `~/.openclaw/.env` | OpenAI Chat | OpenClaw (`$OPENCLAW_CONFIG_PATH` / `$OPENCLAW_STATE_DIR` override) |
| `setup-hermes` | `~/.hermes/config.yaml` + `~/.hermes/.env` | OpenAI Chat | Hermes Agent (`$HERMES_HOME` override) |
| `setup-pi` | `~/.pi/agent/models.json` + `~/.pi/agent/settings.json` | OpenAI Chat | Pi (`$PI_CODING_AGENT_DIR` override) |
| `setup-reasonix` | `~/.reasonix/config.toml` + `~/.reasonix/.env` | OpenAI Chat | Reasonix (`%APPDATA%/reasonix` on Windows, `$REASONIX_HOME` override) |
| `setup-zcode` | `~/.zcode/v2/provider_config.json` | OpenAI Chat | ZCode (`$ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` override) |
| `setup-cursor` | guide only | OpenAI Chat | Manual `Cursor Settings → Models → Add Model` (no file) |
| `setup-generic` | guide only | OpenAI Chat | Any OpenAI-compatible client |

## Zero-persistence launchers

```bash
npx omnipix launch            # injects ANTHROPIC_* vars into `claude`
npx omnipix launch-codex      # injects -c provider overrides into `codex`
```

These do not write config files. `launch` spawns `claude` with `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_MODEL` (plus `CLAUDE_CONFIG_DIR` for `--profile`) in env only; `launch-codex` spawns `codex` with `-c model_provider`/`-c model`/`-c model_providers.omnipix.*` overrides and `OMNIPIX_API_KEY` in env. Useful for ephemeral or shared machines.

## `omnipix doctor`

```bash
npx omnipix doctor
```

Proves a client's requests reach this gateway (checks routed `Authorization` header, catalog, live probe).

## Common flags

| Flag | Effect |
| --- | --- |
| `--dry-run` | Preview changes without writing; shows diff |
| `--model <id>` | Pin to a model (resolved against unfiltered catalog) |
| `--profile <name>` | Named profile (Codex `codex --profile NAME`, Claude `CLAUDE_CONFIG_DIR`) |

## Related

- [Config files](02-config-files.md) — merge strategies, `tools.json`, adding a new generator.
- [Clients & agents](../clients/01-agent-clients.md) — per-agent wiring recipes, headerless URL tokens, MCP.
