#!/bin/bash
# One-shot dsh task through OmniPix. Exits 0 with the agent's final answer.
set -euo pipefail
TASK="${1:-Reply with the single word pineapple}"
if [ -z "${OMNIPIX_API_KEY:-}" ]; then
  echo "error: export OMNIPIX_API_KEY first (see README.md)" >&2
  exit 2
fi
exec npx -y @deepseek-ai/dsh@0.2.2-rc.3 --profile headless "$TASK"
