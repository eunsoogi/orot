#!/usr/bin/env bash
set -euo pipefail

mode="${1:-build}"
if [[ $# -gt 1 || ("$mode" != pods && "$mode" != build) ]]; then
  printf 'Usage: %s [pods|build]\n' "$0" >&2
  exit 2
fi

if [[ "$mode" == pods ]]; then
  pnpm --filter @orot/mobile ios:pods
  exit 0
fi

host_arch="$(uname -m)"
case "$host_arch" in
  arm64 | x86_64) ;;
  *)
    printf 'Unsupported iOS Simulator host architecture: %s\n' "$host_arch" >&2
    exit 1
    ;;
esac
node_arch="$(node -p 'process.arch')"
case "$host_arch:$node_arch" in
  arm64:arm64 | x86_64:x64) ;;
  *)
    printf 'Node architecture %s does not match host architecture %s.\n' "$node_arch" "$host_arch" >&2
    exit 1
    ;;
esac

if [[ "${GITHUB_ACTIONS:-}" == true ]]; then
  # Capture the actual CocoaPods outputs so manifest writing can detect later drift.
  node scripts/ci/detox-derived-data-cache.mjs verify-build-inputs production
fi

# CI keeps Xcode outputs separate from CocoaPods Codegen under ios/build/generated.
# Match Xcode's app slice to the runner and Node architectures required by cache validation.
xcodebuild \
  -workspace apps/mobile/ios/OrotMobile.xcworkspace \
  -scheme OrotMobile \
  -configuration Debug \
  -sdk iphonesimulator \
  -derivedDataPath apps/mobile/ios/build-production \
  CODE_SIGNING_ALLOWED=NO \
  ARCHS="$host_arch" \
  ONLY_ACTIVE_ARCH=YES
