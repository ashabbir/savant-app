#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "==> Client tests"
cd "$ROOT/client"
npm test
npm run test:coverage
npm run test:frontend

echo "==> Server backend tests (Python 3.11 venv)"
cd "$ROOT/server"
if [[ ! -d ".venv" ]]; then
  python3.11 -m venv .venv
fi
.venv/bin/pip install -q -r requirements-dev.txt
.venv/bin/python -m pytest

echo "All test suites passed."
