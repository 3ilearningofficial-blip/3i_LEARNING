#!/usr/bin/env bash
# Local production Android App Bundle (.aab) via EAS — run inside WSL Ubuntu.
set -euo pipefail

export ANDROID_HOME="${ANDROID_HOME:-$HOME/android}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$HOME/android}"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
export EAS_BUILD_NO_EXPO_GO_WARNING=true
export EXPO_PUBLIC_DOMAIN="${EXPO_PUBLIC_DOMAIN:-3ilearning.in}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_DIR"

echo "Project: $PROJECT_DIR"
echo "ANDROID_HOME: $ANDROID_HOME"
echo "EXPO_PUBLIC_DOMAIN: $EXPO_PUBLIC_DOMAIN"
echo "Starting EAS local production AAB build..."

eas build --platform android --profile production --local --non-interactive

echo ""
echo "Build finished. Find the .aab path printed above, or run:"
echo "  find ~ /tmp/panka -name '*.aab' -mmin -30 2>/dev/null"
