#!/bin/bash
# Generate build-info.json with version, branch, commit, worktree
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

VERSION=$(python3 -c "import json; print(json.load(open('package.json'))['version'])" 2>/dev/null || echo "unknown")
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
GIT_DIR=$(git rev-parse --git-dir 2>/dev/null)
COMMON_DIR=$(git rev-parse --git-common-dir 2>/dev/null)
WORKTREE="null"
if [ -n "$GIT_DIR" ] && [ -n "$COMMON_DIR" ]; then
  REAL_GIT=$(cd "$GIT_DIR" 2>/dev/null && pwd)
  REAL_COMMON=$(cd "$COMMON_DIR" 2>/dev/null && pwd)
  if [ "$REAL_GIT" != "$REAL_COMMON" ]; then
    WORKTREE="\"$(pwd)\""
  fi
fi

cat > savant/build-info.json <<EOF
{"version": "$VERSION", "branch": "$BRANCH", "commit": "$COMMIT", "worktree": $WORKTREE, "built_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
EOF

echo "Build info: v$VERSION · $BRANCH · $COMMIT"

osascript -e 'quit app "Savant"' && sleep 2 && rm -rf dist && npm run build && rsync -a --delete dist/mac-arm64/Savant.app/ /Applications/Savant.app/ && open /Applications/Savant.app

