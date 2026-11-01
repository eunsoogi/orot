#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
orot_test_root="$(mktemp -d "${TMPDIR:-/tmp}/orot-navigation-regions-host.XXXXXX")"
trap 'rm -rf "$orot_test_root"' EXIT

# Compile the production decoder and matcher directly so the regression needs no Simulator.
xcrun swiftc -parse-as-library \
  "$repository_root/apps/mobile/ios/OrotUITests/NavigationGeometryReservedRegionMatcher.swift" \
  "$repository_root/scripts/tests/NavigationGeometryReservedRegionHostRegression.swift" \
  -o "$orot_test_root/NavigationGeometryReservedRegionHostRegression"

"$orot_test_root/NavigationGeometryReservedRegionHostRegression" \
  "$repository_root/scripts/tests/fixtures/duplicate-reserved-region-observation.json"
