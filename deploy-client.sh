#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

APP_BUNDLE_PATH="${CLIENT_APP_BUNDLE_PATH:-$ROOT/client/dist/mac-arm64/Savant.app}"
TARGET_DIR="${CLIENT_DEPLOY_DIR:-/Applications}"
TARGET_APP="$TARGET_DIR/Savant.app"
OPEN_AFTER_DEPLOY="${OPEN_CLIENT_AFTER_DEPLOY:-1}"

if [[ ! -d "$APP_BUNDLE_PATH" ]]; then
  echo "Built app bundle not found: $APP_BUNDLE_PATH" >&2
  echo "Run ./build-client.sh first or set CLIENT_APP_BUNDLE_PATH." >&2
  exit 1
fi

mkdir -p "$TARGET_DIR"
rsync -a --delete "$APP_BUNDLE_PATH/" "$TARGET_APP/"

# Unsigned local builds often require quarantine removal.
xattr -cr "$TARGET_APP" || true

echo "Client deployed: $TARGET_APP"

if [[ "$OPEN_AFTER_DEPLOY" == "1" ]]; then
  open "$TARGET_APP"
fi
