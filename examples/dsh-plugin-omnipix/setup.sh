#!/bin/bash
# Install the OmniPix route into the dsh headless profile.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="$DSH_HOME/profiles/headless"
mkdir -p "$PROFILE_DIR"
cp "$HERE/patch/omnipix-llm.patch.yml" "$PROFILE_DIR/cordis.patch.yml"
echo "patched: $PROFILE_DIR/cordis.patch.yml"
echo ""
echo "Next: export your OmniPix unified key (dashboard -> Keys -> Unified API key):"
echo "  export OMNIPIX_API_KEY='omnipix-...'"
echo "Then verify:"
echo "  ./verify.sh \"Reply with the single word pineapple\""
