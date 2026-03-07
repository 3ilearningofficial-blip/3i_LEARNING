#!/bin/bash
set -e

echo "=== Building 3i Learning for deployment ==="

echo "Step 1: Building Expo web app..."
EXPO_PUBLIC_DOMAIN=$REPLIT_INTERNAL_APP_DOMAIN npx expo export --platform web --output-dir static-build/web

echo "Step 2: Building native bundles..."
node scripts/build.js

echo "Step 3: Building server..."
npx esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=server_dist

echo "=== Build complete! ==="
