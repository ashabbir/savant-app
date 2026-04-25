#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$ROOT/server"

if [[ ! -d "$SERVER_DIR" ]]; then
  echo "server directory not found: $SERVER_DIR" >&2
  exit 1
fi

MODE="${BUILD_SERVER_MODE:-docker}"        # docker | python
IMAGE_TAG="${SERVER_IMAGE_TAG:-savant-server:latest}"

case "$MODE" in
  docker)
    docker build -t "$IMAGE_TAG" "$SERVER_DIR"
    echo "Server image built: $IMAGE_TAG"
    ;;
  python)
    cd "$SERVER_DIR"
    if [[ ! -d .venv ]]; then
      python3 -m venv .venv
    fi
    .venv/bin/pip install -r requirements.txt
    .venv/bin/python -m pytest -q
    echo "Server python build checks complete."
    ;;
  *)
    echo "Unsupported BUILD_SERVER_MODE: $MODE (use docker or python)" >&2
    exit 1
    ;;
esac
