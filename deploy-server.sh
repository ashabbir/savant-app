#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$ROOT/server"

MODE="${DEPLOY_SERVER_MODE:-docker}"       # docker | local

case "$MODE" in
  docker)
    IMAGE_TAG="${SERVER_IMAGE_TAG:-savant-server:latest}"
    CONTAINER_NAME="${SERVER_CONTAINER_NAME:-savant-server}"
    HOST_PORT="${SERVER_HOST_PORT:-8090}"
    DATA_DIR="${SERVER_DATA_DIR:-$HOME/.savant-server-data}"

    mkdir -p "$DATA_DIR"

    if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
      docker rm -f "$CONTAINER_NAME" >/dev/null
    fi

    docker run -d \
      --name "$CONTAINER_NAME" \
      -p "$HOST_PORT:8090" \
      -v "$DATA_DIR:/data" \
      -e SAVANT_DB=/data/savant.db \
      -e META_DIR=/data/meta \
      "$IMAGE_TAG"

    echo "Server deployed (docker): $CONTAINER_NAME on port $HOST_PORT"
    ;;

  local)
    cd "$SERVER_DIR"
    if [[ ! -d .venv ]]; then
      python3 -m venv .venv
    fi
    .venv/bin/pip install -r requirements.txt

    HOST="${SERVER_HOST:-0.0.0.0}"
    PORT="${SERVER_PORT:-8090}"
    LOG_FILE="${SERVER_LOG_FILE:-$SERVER_DIR/server.log}"

    nohup .venv/bin/gunicorn \
      --bind "$HOST:$PORT" \
      --workers "${SERVER_WORKERS:-2}" \
      --threads "${SERVER_THREADS:-4}" \
      app:app >"$LOG_FILE" 2>&1 &

    echo "Server deployed (local): http://$HOST:$PORT"
    echo "Log: $LOG_FILE"
    ;;

  *)
    echo "Unsupported DEPLOY_SERVER_MODE: $MODE (use docker or local)" >&2
    exit 1
    ;;
esac
