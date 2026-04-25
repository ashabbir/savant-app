#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

echo "==> Running client unit tests"
npm test

echo "==> Running client coverage tests"
npm run test:coverage

echo "==> Running client frontend/integration tests"
npm run test:frontend

echo "Client test suites passed."
