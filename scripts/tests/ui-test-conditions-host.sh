#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
orot_test_root="$(mktemp -d "${TMPDIR:-/tmp}/orot-ui-conditions-host.XXXXXX")"
trap 'rm -rf "$orot_test_root"' EXIT
orot_test_frameworks="$(xcrun --sdk macosx --show-sdk-platform-path)/Developer/Library/Frameworks"

# Compile the real helper with module-local doubles; no copied implementation or Simulator is used.
xcrun swiftc -parse-as-library \
  -F "$orot_test_frameworks" -Xlinker -rpath -Xlinker "$orot_test_frameworks" \
  "$repository_root/apps/mobile/ios/OrotUITests/UITestConditions.swift" \
  "$repository_root/scripts/tests/UITestConditionsHostDoubles.swift" \
  "$repository_root/scripts/tests/UITestConditionsHostRegression.swift" \
  -o "$orot_test_root/UITestConditionsHostRegression"

"$orot_test_root/UITestConditionsHostRegression"
