#!/usr/bin/env bash
# The OmniPix installer moved to https://omnipix.co/install.sh
# This shim keeps old `curl ... github.io ... | bash` one-liners working.
set -euo pipefail
exec bash -c "$(curl -fsSL https://omnipix.co/install.sh)"
