#!/usr/bin/env bash
# OmniPix one-line installer.
#
#   curl -fsSL https://omnipix.co/install.sh | bash
#   curl -fsSL https://omnipix.co/install.sh | bash -s -- --cli
#
# Default installs the Docker stack into ~/omnipix (re-run safe: .env and
# data are preserved, the checkout updates, the container rebuilds).
# --cli installs the `omnipix` command globally from GitHub instead.
set -euo pipefail

REPO_URL="https://github.com/VedasarathiV/omnipix.git"
RAW_BASE="https://raw.githubusercontent.com/VedasarathiV/omnipix/main"
DIR="${OMNIPIX_DIR:-$HOME/omnipix}"
MODE="docker"

usage() {
  cat <<'EOF'
Usage: install.sh [--docker] [--cli] [--dir PATH] [--help]

  --docker    Install the Docker stack (default).
  --cli       Install the `omnipix` CLI globally (needs Node.js 22+, npm, git).
  --dir PATH  Install directory (default: ~/omnipix). Env OMNIPIX_DIR also works.
  --help      Show this help.
EOF
}

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: $1 is required but not installed ($2)" >&2
    return 1
  fi
}

# Node floor for the CLI path: engines wants >=20.18, the server needs 22
# for its native SQLite binding, so installers must hand over 22+.
check_node() {
  need node "install one from https://nodejs.org" || return 1
  local ver major
  ver="$(node --version | sed 's/^v//')"
  major="${ver%%.*}"
  if [ "${major:-0}" -lt 22 ]; then
    echo "error: omnipix needs Node.js 22 or newer (found $ver)" >&2
    return 1
  fi
}

sync_repo() {
  need git "install git first" || return 1
  if [ -d "$DIR/repo/.git" ]; then
    git -C "$DIR/repo" pull --ff-only --quiet
  else
    mkdir -p "$DIR"
    git clone --depth 1 --quiet "$REPO_URL" "$DIR/repo"
  fi
}

ensure_env() {
  if [ -f "$DIR/repo/.env" ]; then
    return 0
  fi
  local key
  if command -v openssl >/dev/null 2>&1; then
    key="$(openssl rand -hex 32)"
  else
    key="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
  fi
  {
    echo "ENCRYPTION_KEY=$key"
    echo "PORT=3001"
  } >"$DIR/repo/.env"
  echo "generated $DIR/repo/.env (encryption key kept on re-runs)"
}

install_docker() {
  need docker "install Docker Desktop first" || return 1
  sync_repo || return 1
  ensure_env || return 1
  (cd "$DIR/repo" && docker compose up -d --build)
  cat <<'EOF'

OmniPix is up at http://localhost:3001
Next: open the Keys page, add a provider key, and copy the unified API key.
Re-running this script updates the checkout and rebuilds the container.
EOF
}

install_cli() {
  check_node || return 1
  need npm "it ships with Node.js" || return 1
  sync_repo || return 1
  (cd "$DIR/repo/cli" && npm install -g .)
  command -v omnipix >/dev/null 2>&1 || {
    echo "error: install finished but 'omnipix' is not on PATH (check your npm prefix)" >&2
    return 1
  }
  omnipix --help >/dev/null
  echo "omnipix CLI installed."
  echo "Next: point it at a gateway: omnipix doctor --url http://localhost:3001"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --docker) MODE="docker"; shift ;;
    --cli) MODE="cli"; shift ;;
    --dir) DIR="$2"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "error: unknown option '$1'" >&2; usage >&2; exit 1 ;;
  esac
done

if [ "$MODE" = "cli" ]; then
  install_cli
else
  install_docker
fi
