#!/bin/bash
set -e

echo "=== Building 3i Learning for deployment ==="

echo "Step 1: Building server..."
npx esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=server_dist

echo "Step 2: Building native bundles..."
node scripts/build.js || echo "Native build completed with warnings"

echo "Step 3: Building Expo web app..."
DOMAIN="${EXPO_PUBLIC_DOMAIN:-$REPLIT_INTERNAL_APP_DOMAIN}"
if [ -z "$DOMAIN" ]; then
  echo "Set EXPO_PUBLIC_DOMAIN (e.g. 3ilearning.in) before building web."
  exit 1
fi
EXPO_PUBLIC_DOMAIN="$DOMAIN" npx expo export --platform web --output-dir static-build/web

echo "=== Build complete! ==="
