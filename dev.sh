#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SERVER_URL="${SAVANT_SERVER_URL:-http://127.0.0.1:8090}"
BASE_CODE_HOST_DIR="${BASE_CODE_HOST_DIR:-/Users/ahmedshabbir/code/archived}"

cd "$ROOT"

BASE_CODE_HOST_DIR="$BASE_CODE_HOST_DIR" docker compose up -d --build

cd "$ROOT/client"
SAVANT_SERVER_URL="$SERVER_URL" npm run dev
