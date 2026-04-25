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
    MCP_WORKSPACE_PORT="${SERVER_MCP_WORKSPACE_PORT:-8091}"
    MCP_ABILITIES_PORT="${SERVER_MCP_ABILITIES_PORT:-8092}"
    MCP_CONTEXT_PORT="${SERVER_MCP_CONTEXT_PORT:-8093}"
    MCP_KNOWLEDGE_PORT="${SERVER_MCP_KNOWLEDGE_PORT:-8094}"
    DATA_VOLUME="${SERVER_DATA_VOLUME:-savant-server-data}"
    docker volume create "$DATA_VOLUME" >/dev/null

    if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
      docker rm -f "$CONTAINER_NAME" >/dev/null
    fi

    docker run -d \
      --name "$CONTAINER_NAME" \
      --read-only \
      --cap-drop ALL \
      --security-opt no-new-privileges:true \
      --pids-limit "${SERVER_PIDS_LIMIT:-512}" \
      --tmpfs /tmp:rw,noexec,nosuid,size=256m \
      --tmpfs /run:rw,noexec,nosuid,size=64m \
      -p "$HOST_PORT:8090" \
      -p "$MCP_WORKSPACE_PORT:8091" \
      -p "$MCP_ABILITIES_PORT:8092" \
      -p "$MCP_CONTEXT_PORT:8093" \
      -p "$MCP_KNOWLEDGE_PORT:8094" \
      --mount "type=volume,source=$DATA_VOLUME,target=/data/savant" \
      -e SAVANT_SERVER_DATA_DIR=/data/savant \
      -e SAVANT_API_ONLY=1 \
      -e SESSION_DIR=/nonexistent \
      -e CLAUDE_DIR=/nonexistent \
      -e GEMINI_DIR=/nonexistent \
      -e CODEX_DIR=/nonexistent \
      -e HERMES_DIR=/nonexistent \
      -e META_DIR=/nonexistent \
      "$IMAGE_TAG"

    echo "Server deployed (docker): $CONTAINER_NAME on port $HOST_PORT"
    echo "MCP ports: workspace=$MCP_WORKSPACE_PORT abilities=$MCP_ABILITIES_PORT context=$MCP_CONTEXT_PORT knowledge=$MCP_KNOWLEDGE_PORT"
    echo "Data volume: $DATA_VOLUME"
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
