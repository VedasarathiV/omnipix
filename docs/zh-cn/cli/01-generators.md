[English](../../en/cli/01-generators.md) · **简体中文**

# 安装生成器

## 用法

```bash
npx omnipix setup-claude        # 接入 Claude Code
npx omnipix setup-codex         # 接入 Codex CLI
npx omnipix setup-dsh           # 接入 DeepSeek Harness
npx omnipix setup-mimo          # 接入 MiMo Code
npx omnipix setup-atomcode      # 接入 AtomCode
npx omnipix --dry-run setup-claude  # 预览而不写入
npx omnipix setup-claude --model gpt-4o  # 固定模型
```

生成之前，`setup()`（`cli/src/index.ts`）会先拉取实时目录（纯指引的 `setup-cursor` 不需要目录和密钥，会跳过此步）、对照未过滤目录解析 `--model`（`c942352`）。每个生成器（`cli/src/tools.ts`）随后对已有配置做带时间戳的备份、在不覆盖无关键的前提下合并；敏感文件（密钥、令牌）以 `0600` 权限写入，其余为 `0644`，敏感文件的备份同样为 `0600`。

## 生成器一览

| 命令 | 目标文件 | 协议 | 备注 |
| --- | --- | --- | --- |
| `setup-claude` | `~/.claude/settings.json` | Anthropic Messages | `ANTHROPIC_BASE_URL`/`AUTH_TOKEN`/`MODEL`、`CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1`、`launch` 零持久化启动器 |
| `setup-codex` | `~/.codex/config.toml` | OpenAI Responses | `[model_providers.omnipix]` `wire_api=responses`、`launch-codex` 启动器 |
| `setup-cline` | `~/.cline/data/settings/providers.json` | OpenAI Chat | Cline VS Code 扩展 |
| `setup-continue` | `~/.continue/config.yaml` + `~/.continue/.env` | OpenAI Chat | Continue 幽灵文本自动补全 |
| `setup-aider` | `~/.aider.conf.yml` | OpenAI Chat | Aider 结对编程 |
| `setup-opencode` | `~/.config/opencode/opencode.json` + 密钥写入 `~/.local/share/opencode/auth.json` | OpenAI Chat | OpenCode 智能体（可用 `$XDG_CONFIG_HOME` / `$XDG_DATA_HOME` 覆盖） |
| `setup-goose` | `~/.config/goose/custom_providers/omnipix.json` + `~/.config/goose/config.yaml` | OpenAI Chat | Goose 智能体 |
| `setup-qwen` | `~/.qwen/settings.json` + `~/.qwen/.env` | OpenAI/Gemini | Qwen Code，`/v1` 或原生 `/v1beta` |
| `setup-roo` | `~/.roo/omnipix.json` + `~/.roo/omnipix-cli.json` + `~/.roo/cli-settings.json` | OpenAI Chat | Roo Code |
| `setup-kilo` | `~/.config/kilo/kilo.jsonc` | OpenAI Chat | Kilo Code |
| `setup-crush` | `~/.config/crush/crush.json` | OpenAI Chat | Crush（charmbracelet） |
| `setup-dsh` | `$DSH_HOME/settings.yaml` + `$DSH_HOME/.env`（默认 `~/.dsh`） | OpenAI Chat | DeepSeek Harness（#995） |
| `setup-mimo` | `~/.config/mimocode/config.json` | OpenAI Chat | MiMo Code JSON `provider.omnipix`（`@ai-sdk/openai-compatible`、`{env:OMNIPIX_API_KEY}` 替换；可用 `$MIMOCODE_HOME/config` 覆盖）（#1003） |
| `setup-atomcode` | `~/.atomcode/config.toml` | OpenAI Chat | `default_model=omnipix` + `[provider_accounts.omnipix]` + `[models.omnipix]`；保留其他账户、模型和旧版提供方配置 |
| `setup-openclaw` | `~/.openclaw/openclaw.json` + `~/.openclaw/.env` | OpenAI Chat | OpenClaw（可用 `$OPENCLAW_CONFIG_PATH` / `$OPENCLAW_STATE_DIR` 覆盖） |
| `setup-hermes` | `~/.hermes/config.yaml` + `~/.hermes/.env` | OpenAI Chat | Hermes Agent（可用 `$HERMES_HOME` 覆盖） |
| `setup-pi` | `~/.pi/agent/models.json` + `~/.pi/agent/settings.json` | OpenAI Chat | Pi（可用 `$PI_CODING_AGENT_DIR` 覆盖） |
| `setup-reasonix` | `~/.reasonix/config.toml` + `~/.reasonix/.env` | OpenAI Chat | Reasonix（Windows 下为 `%APPDATA%/reasonix`，可用 `$REASONIX_HOME` 覆盖） |
| `setup-zcode` | `~/.zcode/v2/provider_config.json` | OpenAI Chat | ZCode（可用 `$ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` 覆盖） |
| `setup-cursor` | 仅指引 | OpenAI Chat | 手动 `Cursor Settings → Models → Add Model`（无文件） |
| `setup-generic` | 仅指引 | OpenAI Chat | 任意 OpenAI 兼容客户端 |

## 零持久化启动器

```bash
npx omnipix launch            # 向 `claude` 注入 ANTHROPIC_* 变量
npx omnipix launch-codex      # 向 `codex` 注入 -c 提供方覆盖参数
```

这些命令不会写入配置文件。`launch` 仅在环境变量中向 `claude` 注入 `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_MODEL`（`--profile` 时另加 `CLAUDE_CONFIG_DIR`）；`launch-codex` 向 `codex` 传入 `-c model_provider`/`-c model`/`-c model_providers.omnipix.*` 覆盖参数，并在环境变量中注入 `OMNIPIX_API_KEY`。适用于临时或共享机器。

## `omnipix doctor`

```bash
npx omnipix doctor
```

验证客户端请求是否到达本网关（检查已路由的 `Authorization` 头、目录、实时探针）。

## 通用参数

| 参数 | 作用 |
| --- | --- |
| `--dry-run` | 预览变更而不写入；显示 diff |
| `--model <id>` | 固定到指定模型（对照未过滤目录解析） |
| `--profile <name>` | 命名配置档（Codex `codex --profile NAME`、Claude `CLAUDE_CONFIG_DIR`） |

## 相关

- [配置文件](02-config-files.md) —— 合并策略、`tools.json`、新增生成器。
- [客户端与编程智能体](../clients/01-agent-clients.md) —— 按智能体接入配方、无头 URL 令牌、MCP。
