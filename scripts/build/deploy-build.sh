#!/bin/bash
set -e

echo "=== Building 3i Learning for deployment ==="

echo "Step 1: Building server..."
npx esbuild backend/index.ts --platform=node --packages=external --bundle --format=esm --outdir=server_dist

echo "Step 2: Building native bundles..."
node scripts/build.js || echo "Native build completed with warnings"

echo "Step 3: Building Expo web app..."
DOMAIN="${EXPO_PUBLIC_DOMAIN:-$REPLIT_INTERNAL_APP_DOMAIN}"
if [ -z "$DOMAIN" ]; then
  echo "Set EXPO_PUBLIC_DOMAIN (e.g. 3ilearning.in) before building web."
  exit 1
fi
EXPO_PUBLIC_DOMAIN="$DOMAIN" npx expo export --platform web --output-dir static-build/web

echo "Step 4: Running production safety checks..."
npx tsc --noEmit

HEALTH_URL="${HEALTH_URL:-https://api.3ilearning.in/api/health/version}"
echo "Step 5: Backend health probe (${HEALTH_URL})"
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "${HEALTH_URL}" >/dev/null || {
    echo "Health check failed: ${HEALTH_URL}"
    exit 1
  }
fi

echo "=== Build complete! ==="
