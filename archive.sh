#!/bin/bash
# Archive the current build into arch-version/<version>/
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VERSION=$(node -p "require('$SCRIPT_DIR/package.json').version")
FOLDER_NAME=$(echo "$VERSION" | tr '.' '-')
ARCH_DIR="$SCRIPT_DIR/arch-version/$FOLDER_NAME"
DIST_DIR="$SCRIPT_DIR/dist"

DMG="$DIST_DIR/Savant-${VERSION}-arm64.dmg"
BLOCKMAP="$DIST_DIR/Savant-${VERSION}-arm64.dmg.blockmap"

if [ ! -f "$DMG" ]; then
  echo "ERROR: $DMG not found. Run 'npm run build' first."
  exit 1
fi

mkdir -p "$ARCH_DIR"
cp "$DMG" "$ARCH_DIR/"
[ -f "$BLOCKMAP" ] && cp "$BLOCKMAP" "$ARCH_DIR/"

echo "Archived v${VERSION} → arch-version/${FOLDER_NAME}/"
ls -lh "$ARCH_DIR/"
