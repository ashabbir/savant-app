#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

export EB_TELEMETRY=0
export ELECTRON_BUILDER_OFFLINE=1

if [[ ! -d "node_modules" ]]; then
  npm install
fi

npm run build
