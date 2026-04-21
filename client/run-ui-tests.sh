#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

echo "==> Running client Electron UI tests"
npm run test:ui

echo "Client UI test suite passed."
