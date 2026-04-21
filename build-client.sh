#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
CLIENT_DIR="$ROOT/client"

if [[ ! -d "$CLIENT_DIR" ]]; then
  echo "client directory not found: $CLIENT_DIR" >&2
  exit 1
fi

cd "$CLIENT_DIR"

if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi

npm run build

echo "Client build complete."
