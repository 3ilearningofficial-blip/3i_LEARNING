#!/bin/bash
set -e

echo "Building web app..."
EXPO_PUBLIC_DOMAIN=$REPLIT_INTERNAL_APP_DOMAIN npx expo export --platform web --output-dir static-build/web

echo "Building server..."
npx esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=server_dist

echo "Build complete!"
