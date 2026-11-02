#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
orot_host_root="$(mktemp -d "${TMPDIR:-/tmp}/orot-native-swift.XXXXXX")"
trap 'rm -rf "$orot_host_root"' EXIT
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
xcrun swift test --package-path "$orot_host_root"
