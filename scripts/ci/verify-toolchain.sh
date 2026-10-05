#!/usr/bin/env bash
set -euo pipefail

expected_node="${EXPECTED_NODE_VERSION:-22.23.2}"
expected_pnpm="${EXPECTED_PNPM_VERSION:-12.3.4}"
expected_macos="${EXPECTED_MACOS_VERSION:-27.0}"
expected_xcode="${EXPECTED_XCODE_VERSION:-27.0}"
expected_simulator_sdk="${EXPECTED_IOS_SIMULATOR_SDK:-27.0}"
expected_ruby="${EXPECTED_RUBY_VERSION:-4.0.7}"
expected_cocoapods="${EXPECTED_COCOAPODS_VERSION:-1.17.0}"
verify_simulator_availability=true
verify_cocoapods=false

fail_version() {
  printf 'Toolchain mismatch for %s: expected %s, got %s\n' "$1" "$2" "$3" >&2
  exit 1
}

actual_node="$(node -p 'process.versions.node')"
[[ "$actual_node" == "$expected_node" ]] || fail_version Node "$expected_node" "$actual_node"

actual_pnpm="$(pnpm --version)"
[[ "$actual_pnpm" == "$expected_pnpm" ]] || fail_version pnpm "$expected_pnpm" "$actual_pnpm"

actual_macos="$(sw_vers -productVersion)"
[[ "$actual_macos" == "$expected_macos" ]] || fail_version macOS "$expected_macos" "$actual_macos"

actual_developer_dir="${DEVELOPER_DIR:-}"
[[ "$actual_developer_dir" == "/Applications/Xcode.app/Contents/Developer" ]] || fail_version DEVELOPER_DIR /Applications/Xcode.app/Contents/Developer "$actual_developer_dir"
actual_xcode="$(xcodebuild -version | sed -n '1s/^Xcode //p')"
[[ "$actual_xcode" == "$expected_xcode" ]] || fail_version Xcode "$expected_xcode" "$actual_xcode"

actual_simulator_sdk="$(xcrun --sdk iphonesimulator --show-sdk-version)"
[[ "$actual_simulator_sdk" == "$expected_simulator_sdk" ]] || fail_version iOS-Simulator-SDK "$expected_simulator_sdk" "$actual_simulator_sdk"

for argument in "$@"; do
  case "$argument" in
    --cocoapods) verify_cocoapods=true ;;
    --skip-simulator-availability) verify_simulator_availability=false ;;
    *)
      printf 'Usage: %s [--cocoapods] [--skip-simulator-availability]\n' "$0" >&2
      exit 2
      ;;
  esac
done

# Profile setup creates the selected device before this check and waits for its boot later; skipping this listing lets cache preparation overlap asynchronous boot.
if [[ "$verify_simulator_availability" == true ]]; then
  xcrun simctl list devices available | grep -Fq 'iPhone 18 Pro' || fail_version iPhone-Simulator iPhone-18-Pro unavailable
fi

if [[ "$verify_cocoapods" == true ]]; then
  actual_ruby="$(ruby -e 'print RUBY_VERSION')"
  [[ "$actual_ruby" == "$expected_ruby" ]] || fail_version Ruby "$expected_ruby" "$actual_ruby"
  actual_cocoapods="$(pod --version)"
  [[ "$actual_cocoapods" == "$expected_cocoapods" ]] || fail_version CocoaPods "$expected_cocoapods" "$actual_cocoapods"
fi

printf 'Verified macOS %s, Xcode %s, iOS Simulator SDK %s, Node %s, pnpm %s\n' \
  "$actual_macos" "$actual_xcode" "$actual_simulator_sdk" "$actual_node" "$actual_pnpm"
if [[ "$verify_cocoapods" == true ]]; then
  printf 'Verified Ruby %s and CocoaPods %s\n' "$actual_ruby" "$actual_cocoapods"
fi
