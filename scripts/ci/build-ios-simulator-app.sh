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

# CI keeps Xcode outputs separate from CocoaPods Codegen under ios/build/generated.
xcodebuild \
  -workspace apps/mobile/ios/OrotMobile.xcworkspace \
  -scheme OrotMobile \
  -configuration Debug \
  -sdk iphonesimulator \
  -derivedDataPath apps/mobile/ios/build-production \
  CODE_SIGNING_ALLOWED=NO
