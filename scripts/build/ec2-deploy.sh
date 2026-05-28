#!/usr/bin/env bash
# ============================================================
# ec2-deploy.sh — Safe production deploy for 3i Learning
# ============================================================
# Usage (from project root on EC2):
#   bash scripts/build/ec2-deploy.sh
#
# What it does, in order:
#   1. Pull latest code from git
#   2. Install dependencies
#   3. Run DB migrations — ABORTS if this fails (FRW-02)
#   4. Build the server bundle
#   5. Reload PM2 with zero-downtime (DIR-01: pm2 reload, not pm2 restart)
#   6. Save PM2 process list
#   7. Health-check the live server
#
# WHY pm2 reload INSTEAD OF pm2 restart:
#   pm2 restart kills all workers at once → 2-3 second outage.
#   pm2 reload does a rolling restart: new process starts, accepts
#   connections, then old process drains and exits gracefully.
#   Students in live classes keep their SSE connections for the drain window.
#
# WHY ABORT ON MIGRATION FAILURE:
#   If db:apply-sql exits non-zero (checksum mismatch, SQL error, etc.)
#   we do NOT restart the server. Starting a server against a partially-
#   migrated schema causes silent data corruption or runtime crashes.
# ============================================================

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$PROJECT_DIR"

echo ""
echo "=========================================="
echo "  3i Learning — EC2 Production Deploy"
echo "  $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "=========================================="
echo ""

# ── Step 1: Pull latest code ────────────────────────────────
echo "[1/7] Pulling latest code..."
git pull --ff-only
echo "      Commit: $(git rev-parse --short HEAD)"

# ── Step 2: Install dependencies ───────────────────────────
echo "[2/7] Installing dependencies..."
npm ci --omit=dev 2>&1 | tail -5

# ── Step 3: Apply DB migrations (ABORT ON FAILURE) ─────────
echo "[3/7] Applying SQL migrations..."
if ! npm run db:apply-sql; then
  echo ""
  echo "  ╔══════════════════════════════════════════════╗"
  echo "  ║  DEPLOY ABORTED — migration step failed.     ║"
  echo "  ║  The server has NOT been restarted.          ║"
  echo "  ║  Fix the migration issue, then re-deploy.    ║"
  echo "  ╚══════════════════════════════════════════════╝"
  echo ""
  exit 1
fi
echo "      Migrations applied successfully."

# ── Step 4: Build server bundle ────────────────────────────
echo "[4/7] Building server bundle..."
npm run server:build
echo "      Build complete."

# ── Step 5: Reload PM2 (zero-downtime rolling restart) ─────
echo "[5/7] Reloading PM2 processes (zero-downtime)..."
if pm2 list | grep -q "ecosystem"; then
  # ecosystem.config.js exists and processes are registered
  pm2 reload ecosystem.config.js --env production
else
  # Fall back to reloading by name if ecosystem wasn't used to start
  pm2 reload backend --update-env 2>/dev/null || pm2 restart backend --update-env
fi
echo "      PM2 reloaded."

# ── Step 6: Save PM2 process list ──────────────────────────
echo "[6/7] Saving PM2 process list..."
pm2 save
echo "      Process list saved."

# ── Step 7: Health check ───────────────────────────────────
echo "[7/7] Health check..."
HEALTH_URL="${HEALTH_URL:-https://api.3ilearning.in/api/health/version}"
sleep 3   # give the new process a moment to fully accept connections
if command -v curl >/dev/null 2>&1; then
  HTTP_STATUS=$(curl -o /dev/null -s -w "%{http_code}" --max-time 10 "$HEALTH_URL" || echo "000")
  if [ "$HTTP_STATUS" = "200" ]; then
    echo "      Health check passed (HTTP $HTTP_STATUS)"
  else
    echo "      WARNING: Health check returned HTTP $HTTP_STATUS — check logs."
    echo "      URL: $HEALTH_URL"
    # Not exiting 1 here: the deploy already succeeded; this is a post-check warning.
  fi
else
  echo "      curl not available — skipping health check."
fi

echo ""
echo "=========================================="
echo "  Deploy complete!"
echo "  Commit: $(git rev-parse --short HEAD)"
echo "  Time:   $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "=========================================="
echo ""
