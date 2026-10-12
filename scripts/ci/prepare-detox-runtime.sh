#!/usr/bin/env bash
set -euo pipefail

case "${1:-}" in
  release | openai-provider | next-visit-questions) exit 0 ;;
  transcription) ;;
  *)
    printf 'Expected one supported Detox profile.\n' >&2
    exit 2
    ;;
esac
[[ $# == 1 && "${GITHUB_ACTIONS:-false}" == true ]] || {
  printf 'Runtime provisioning is restricted to the ephemeral CI runner.\n' >&2
  exit 2
}

# SDK 27 compiles the app; runtime 26.2 retains the measured Korean speech engine.
# Download only the pinned Simulator asset, never replace Xcode or provision a device here.
runtime_available() {
  local inventory
  inventory="$(xcrun simctl list runtimes --json)" || return 1
  printf '%s' "$inventory" | node -e '
const data = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
if (!Array.isArray(data.runtimes)) process.exit(1);
const installed = data.runtimes.some((runtime) =>
  runtime.identifier === "com.apple.CoreSimulator.SimRuntime.iOS-26-2" && runtime.isAvailable);
process.exit(installed ? 0 : 2);
'
}

status=0
runtime_available || status=$?
if [[ "$status" == 0 ]]; then exit 0; fi
# Inventory/parse errors are not evidence that an asset is absent.
[[ "$status" == 2 ]] || exit "$status"
xcodebuild -downloadPlatform iOS -buildVersion 26.2 -architectureVariant arm64
runtime_available || {
  printf 'The pinned iOS 26.2 runtime is unavailable after provisioning.\n' >&2
  exit 1
}
