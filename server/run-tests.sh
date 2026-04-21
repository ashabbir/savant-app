#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

if [[ ! -d ".venv" ]]; then
  python3.11 -m venv .venv
fi

.venv/bin/pip install -q -r requirements-dev.txt
.venv/bin/python -m pytest -v

echo "Server test suite passed."
