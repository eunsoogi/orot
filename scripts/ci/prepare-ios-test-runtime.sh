#!/usr/bin/env bash
set -euo pipefail

case "${1:-}" in
  core | provider-data) exit 0 ;;
  speech) ;;
  *)
    printf 'Expected one supported integration test profile.\n' >&2
    exit 2
    ;;
esac
[[ $# == 1 && "${GITHUB_ACTIONS:-false}" == true ]] || {
  printf 'Runtime provisioning is restricted to the ephemeral CI runner.\n' >&2
  exit 2
}

# SDK 27 compiles the app; 26.2 build 23C54 matches the previously measured speech runtime.
# The release number alone selected 23C52. Pin the universal asset and reject silent build drift.
runtime_available() {
  local inventory
  inventory="$(xcrun simctl list runtimes --json)" || return 1
  printf '%s' "$inventory" | node -e '
const data = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
if (!Array.isArray(data.runtimes)) process.exit(1);
const installed = data.runtimes.find((runtime) =>
  runtime.identifier === "com.apple.CoreSimulator.SimRuntime.iOS-26-2" && runtime.isAvailable);
if (!installed) process.exit(2);
if (installed.buildversion !== "23C54") {
  console.error("Expected iOS 26.2 build 23C54; found " + (installed.buildversion ?? "unknown") + ".");
  process.exit(1);
}
'
}

status=0
runtime_available || status=$?
if [[ "$status" == 0 ]]; then exit 0; fi
# Inventory/parse errors are not evidence that an asset is absent.
[[ "$status" == 2 ]] || exit "$status"
xcodebuild -downloadPlatform iOS -buildVersion 23C54 -architectureVariant universal
runtime_available || {
  printf 'The pinned iOS 26.2 build 23C54 is unavailable after provisioning.\n' >&2
  exit 1
}
