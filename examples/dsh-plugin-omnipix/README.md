# dsh-plugin-omnipix

Route [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`)
through [OmniPix](https://github.com/VedasarathiV/omnipix) — your local
free-model gateway — instead of a paid meter.

No code: dsh's own `llm-pi-ai` plugin already speaks to hand-declared
OpenAI-compatible gateways. This repo is the tested patch that declares
OmniPix as one, plus setup and verification scripts.

## Prerequisites

- Node.js 22+
- `dsh` 0.2.2-rc.3+ (`npx -y @deepseek-ai/dsh@0.2.2-rc.3 --version`)
- OmniPix running with at least one working model (`auto` must answer)

## Setup

```sh
./setup.sh
```

This writes the patch to `$DSH_HOME/profiles/headless/cordis.patch.yml`
(`DSH_HOME` defaults to `~/.dsh`) and prints the export line for your
OmniPix unified key (dashboard → Keys → Unified API key):

```sh
export OMNIPIX_API_KEY='omnipix-...'
```

## Verify

```sh
./verify.sh "Reply with the single word pineapple"
```

Expected: dsh answers through OmniPix (its final answer echoes the task —
the mock proves the wire path; with real keys you get real answers).

## What the patch does

`patch/omnipix-llm.patch.yml` does two things:

1. Configures the mounted `llm-pi-ai` row with an `omnipix` provider route:
   OpenAI-completions protocol, your OmniPix `/v1` base URL, key from
   `OMNIPIX_API_KEY`, models passed through (`auto` + any id).
2. Repoints `agent-default-model` at provider `omnipix`, model `auto`.

To scope it to one invocation instead of the profile, pass it directly:

```sh
dsh --profile headless --patch patch/omnipix-llm.patch.yml "your task"
```

## Files

- `patch/omnipix-llm.patch.yml` — the route + default-model patch
- `env.template` — environment variables (`OMNIPIX_API_KEY`, `OMNIPIX_BASE_URL`)
- `setup.sh` — installs the patch into the headless profile
- `verify.sh` — runs a one-shot task and checks the answer came via OmniPix
