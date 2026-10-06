#!/usr/bin/env bash
set -euo pipefail

expected_node="${EXPECTED_NODE_VERSION:-22.23.2}"
expected_pnpm="${EXPECTED_PNPM_VERSION:-12.3.4}"
expected_macos="${EXPECTED_MACOS_VERSION:-27.0}"
expected_xcode="${EXPECTED_XCODE_VERSION:-27.0}"
expected_simulator_sdk="${EXPECTED_IOS_SIMULATOR_SDK:-27.0}"
expected_simulator_runtime_name="${EXPECTED_IOS_SIMULATOR_RUNTIME_NAME:-iOS 27.0}"
expected_simulator_runtime_id="${EXPECTED_IOS_SIMULATOR_RUNTIME_IDENTIFIER:-com.apple.CoreSimulator.SimRuntime.iOS-27-0}"
expected_simulator_device_name="${EXPECTED_DETOX_SIMULATOR_DEVICE_NAME:-iPhone 18 Pro}"
expected_simulator_device_type_id="${EXPECTED_DETOX_SIMULATOR_DEVICE_TYPE_ID:-com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro}"
expected_ruby="${EXPECTED_RUBY_VERSION:-4.0.7}"
expected_cocoapods="${EXPECTED_COCOAPODS_VERSION:-1.17.0}"

# Node reads the resolved Simulator targets through process.env when matching xcrun output.
export EXPECTED_IOS_SIMULATOR_RUNTIME_NAME="$expected_simulator_runtime_name"
export EXPECTED_IOS_SIMULATOR_RUNTIME_IDENTIFIER="$expected_simulator_runtime_id"
export EXPECTED_DETOX_SIMULATOR_DEVICE_NAME="$expected_simulator_device_name"
export EXPECTED_DETOX_SIMULATOR_DEVICE_TYPE_ID="$expected_simulator_device_type_id"

fail_version() {
  printf 'Toolchain mismatch for %s: expected %s, got %s\n' "$1" "$2" "$3" >&2
  exit 1
}

verify_cocoapods() {
  actual_ruby="$(ruby -e 'print RUBY_VERSION')"
  [[ "$actual_ruby" == "$expected_ruby" ]] || fail_version Ruby "$expected_ruby" "$actual_ruby"
  actual_cocoapods="$(pod --version)"
  [[ "$actual_cocoapods" == "$expected_cocoapods" ]] || fail_version CocoaPods "$expected_cocoapods" "$actual_cocoapods"
}

if [[ "${1:-}" == "--cocoapods-only" ]]; then
  # Detox already checks the full runner before requesting Simulator startup; avoid simctl enumeration during that boot.
  verify_cocoapods
  printf 'Verified Ruby %s and CocoaPods %s\n' "$actual_ruby" "$actual_cocoapods"
  exit 0
fi

actual_node="$(node -p 'process.versions.node')"
[[ "$actual_node" == "$expected_node" ]] || fail_version Node "$expected_node" "$actual_node"

actual_pnpm="$(pnpm --version)"
[[ "$actual_pnpm" == "$expected_pnpm" ]] || fail_version pnpm "$expected_pnpm" "$actual_pnpm"

actual_macos="$(sw_vers -productVersion)"
# The macos-26 hosted label rolls patch releases; keep exact checks for pinned version labels.
if [[ "$expected_macos" =~ ^[0-9]+$ ]]; then
  actual_macos_major="${actual_macos%%.*}"
  [[ "$actual_macos_major" == "$expected_macos" ]] || fail_version macOS "${expected_macos}.x" "$actual_macos"
else
  [[ "$actual_macos" == "$expected_macos" ]] || fail_version macOS "$expected_macos" "$actual_macos"
fi

actual_developer_dir="${DEVELOPER_DIR:-}"
expected_developer_dir="/Applications/Xcode.app/Contents/Developer"
# The macOS 26 runner exposes Xcode 26.2 through its versioned app bundle.
if [[ "$expected_xcode" == "26.2" ]]; then
  expected_developer_dir="/Applications/Xcode_26.2.app/Contents/Developer"
fi
[[ "$actual_developer_dir" == "$expected_developer_dir" ]] || fail_version DEVELOPER_DIR "$expected_developer_dir" "$actual_developer_dir"
actual_xcode_details="$(xcodebuild -version)"
actual_xcode="$(printf '%s\n' "$actual_xcode_details" | sed -n '1s/^Xcode //p')"
[[ "$actual_xcode" == "$expected_xcode" ]] || fail_version Xcode "$expected_xcode" "$actual_xcode"
# Detox derives its extracted-framework directory from the complete Xcode version output.
actual_xcodebuild_fingerprint="$(printf '%s\n' "$actual_xcode_details" | shasum -a 256 | awk '{print $1}')"

actual_simulator_sdk="$(xcrun --sdk iphonesimulator --show-sdk-version)"
[[ "$actual_simulator_sdk" == "$expected_simulator_sdk" ]] || fail_version iOS-Simulator-SDK "$expected_simulator_sdk" "$actual_simulator_sdk"
# Check the installed runtime and device type before profile setup creates its dedicated Simulator.
actual_simulator_runtime="$(xcrun simctl list runtimes --json | node -e '
const fs = require("node:fs");
const data = JSON.parse(fs.readFileSync(0, "utf8"));
const runtime = data.runtimes.find((entry) =>
  entry.name === process.env.EXPECTED_IOS_SIMULATOR_RUNTIME_NAME &&
  entry.identifier === process.env.EXPECTED_IOS_SIMULATOR_RUNTIME_IDENTIFIER &&
  entry.isAvailable
);
process.stdout.write(runtime?.identifier ?? "");
')"
[[ "$actual_simulator_runtime" == "$expected_simulator_runtime_id" ]] || fail_version iOS-Simulator-runtime "$expected_simulator_runtime_name ($expected_simulator_runtime_id)" unavailable
actual_simulator_device="$(xcrun simctl list devices available --json | node -e '
const fs = require("node:fs");
const data = JSON.parse(fs.readFileSync(0, "utf8"));
const devices = data.devices[process.env.EXPECTED_IOS_SIMULATOR_RUNTIME_IDENTIFIER] ?? [];
const device = devices.find((entry) =>
  entry.name === process.env.EXPECTED_DETOX_SIMULATOR_DEVICE_NAME &&
  entry.deviceTypeIdentifier === process.env.EXPECTED_DETOX_SIMULATOR_DEVICE_TYPE_ID &&
  entry.isAvailable
);
process.stdout.write(
  device ? device.name + " (" + device.deviceTypeIdentifier + ")" : ""
);
')"
expected_simulator_device="$expected_simulator_device_name ($expected_simulator_device_type_id)"
[[ "$actual_simulator_device" == "$expected_simulator_device" ]] || fail_version iOS-Simulator-device "$expected_simulator_device on $expected_simulator_runtime_name" unavailable

if [[ "${1:-}" == "--cocoapods" ]]; then
  verify_cocoapods
fi

# Preserve the actual macOS patch for cache keys after validating the expected family.
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  printf 'macos_version=%s\n' "$actual_macos" >>"$GITHUB_OUTPUT"
  printf 'xcodebuild_fingerprint=%s\n' "$actual_xcodebuild_fingerprint" >>"$GITHUB_OUTPUT"
fi
# Keep the verified build identity available to later manifest steps without repeated workflow wiring.
if [[ -n "${GITHUB_ENV:-}" ]]; then
  printf 'XCODEBUILD_FINGERPRINT=%s\n' "$actual_xcodebuild_fingerprint" >>"$GITHUB_ENV"
fi

printf 'Verified macOS %s, Xcode %s (%s), iOS Simulator SDK %s, runtime %s, device %s, Node %s, pnpm %s\n' \
  "$actual_macos" "$actual_xcode" "$actual_developer_dir" "$actual_simulator_sdk" "$expected_simulator_runtime_name ($actual_simulator_runtime)" "$actual_simulator_device" "$actual_node" "$actual_pnpm"
if [[ "${1:-}" == "--cocoapods" ]]; then
  printf 'Verified Ruby %s and CocoaPods %s\n' "$actual_ruby" "$actual_cocoapods"
fi
