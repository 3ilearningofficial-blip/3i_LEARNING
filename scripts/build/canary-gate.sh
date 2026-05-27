#!/usr/bin/env bash
set -euo pipefail

echo "[canary-gate] validating required deployment artifacts"
test -f "docs/DEPLOY_CANARY_CHECKLIST.md"
test -f "scripts/build/deploy-build.sh"
test -f "scripts/build/rollback-last.sh"

echo "[canary-gate] validating feature flag defaults"
node -e "const fs=require('fs');const t=fs.readFileSync('backend/feature-flags.ts','utf8');if(!t.includes('fail_closed_auth_rate_limit'))process.exit(2);if(!t.includes('enable_cloudflare_stream_webhooks'))process.exit(3);"

echo "[canary-gate] success"
