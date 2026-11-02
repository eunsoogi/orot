#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
readonly orot_host_root="$repository_root/.orot-native-swift-host"
umask 077
# Exclusive creation refuses existing data, including symlinks and another run.
mkdir "$orot_host_root"
orot_host_identity="$(stat -f '%u:%d:%i' "$orot_host_root")"
readonly orot_host_identity
cleanup_host_root() {
  local status=$?
  trap - EXIT
  # Refuse cleanup when the scratch identity no longer matches this run.
  if [[ -L "$orot_host_root" || ! -d "$orot_host_root" ]] ||
    [[ "$(stat -f '%u:%d:%i' "$orot_host_root")" != "$orot_host_identity" ]] ||
    [[ "$(stat -f '%u' "$orot_host_root")" != "$(id -u)" ]]; then
    printf '%s\n' "Host scratch identity changed; preserving $orot_host_root" >&2
    exit 1
  fi
  (cd "$repository_root" && rm -rf -- .orot-native-swift-host) || exit 1
  exit "$status"
}
trap cleanup_host_root EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir -p "$orot_host_root/Sources/NativeSwiftRegressions" "$orot_host_root/Tests/NativeSwiftRegressionsTests"

# The temporary package compiles shipping sources and original assertions without
# changing the iOS inventory or leaving host build products in the checkout.
for source in MedicationDoseCursor AppleNativeToolRegistry AppleNativeToolGeneration AppleNativeToolTrace; do
  cp "$repository_root/apps/mobile/ios/OrotMobile/$source.swift" "$orot_host_root/Sources/NativeSwiftRegressions/"
done
for suite in MedicationDoseCursorTests AppleNativeToolLifecycleTests; do
  cp "$repository_root/apps/mobile/ios/OrotIntegrationTests/$suite.swift" "$orot_host_root/Tests/NativeSwiftRegressionsTests/"
done
cat >"$orot_host_root/Package.swift" <<'SWIFT'
// swift-tools-version: 5.9
import PackageDescription
let package = Package(
    name: "NativeSwiftRegressions",
    platforms: [.macOS(.v13)],
    targets: [
        .target(name: "NativeSwiftRegressions", swiftSettings: [.define("OROT_HOST_SWIFT_TESTS")]),
        .testTarget(name: "NativeSwiftRegressionsTests", dependencies: ["NativeSwiftRegressions"],
                    swiftSettings: [.define("OROT_HOST_SWIFT_TESTS")]),
    ]
)
SWIFT
# Limit compiler processes, not the concurrency exercised inside each test.
xcrun swift test --jobs 1 --package-path "$orot_host_root"
