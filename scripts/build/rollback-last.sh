#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   scripts/rollback-last.sh [pm2_app_id] [target_commit]
# Default PM2 app id = 5
# Default target_commit = HEAD~1

APP_ID="${1:-5}"
TARGET_COMMIT="${2:-HEAD~1}"

echo "[rollback] fetching latest refs..."
git fetch --all --prune

echo "[rollback] current commit: $(git rev-parse --short HEAD)"
echo "[rollback] switching to target commit ${TARGET_COMMIT} (non-destructive checkout)..."
git checkout "${TARGET_COMMIT}"

echo "[rollback] installing dependencies..."
npm ci

echo "[rollback] building server..."
npm run server:build

echo "[rollback] restarting pm2 app id ${APP_ID}..."
pm2 restart "${APP_ID}" --update-env
pm2 save

echo "[rollback] done. current commit: $(git rev-parse --short HEAD)"
