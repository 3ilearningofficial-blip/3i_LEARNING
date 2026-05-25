#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   scripts/rollback-last.sh [pm2_app_id]
# Default PM2 app id = 5

APP_ID="${1:-5}"

echo "[rollback] fetching latest refs..."
git fetch --all --prune

echo "[rollback] current commit: $(git rev-parse --short HEAD)"
echo "[rollback] moving to previous commit..."
git reset --hard HEAD~1

echo "[rollback] installing dependencies..."
npm ci

echo "[rollback] building server..."
npm run server:build

echo "[rollback] restarting pm2 app id ${APP_ID}..."
pm2 restart "${APP_ID}" --update-env
pm2 save

echo "[rollback] done. current commit: $(git rev-parse --short HEAD)"
