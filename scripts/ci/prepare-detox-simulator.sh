#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  printf 'Usage: %s <setup-log-path>\n' "$0" >&2
  exit 2
fi

log_path="$1"
mkdir -p "$(dirname "$log_path")"
: > "$log_path"

runtime_id="$(xcrun simctl list runtimes --json | node -e '
const fs = require("node:fs");
const data = JSON.parse(fs.readFileSync(0, "utf8"));
const runtime = data.runtimes.find((entry) => entry.name === "iOS 27.0" && entry.isAvailable);
if (!runtime) process.exit(1);
process.stdout.write(runtime.identifier);
')"
device_type_id='com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro'
run_name="${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}-$$"
simulator_name="Orot Detox CI ${run_name}"
simulator_udid=''

cleanup_on_failure() {
  result=$?
  if [[ "$result" -ne 0 && -n "$simulator_udid" ]]; then
    xcrun simctl shutdown "$simulator_udid" >> "$log_path" 2>&1 || true
    xcrun simctl delete "$simulator_udid" >> "$log_path" 2>&1 || true
  fi
}
trap cleanup_on_failure EXIT

if ! simulator_udid="$(xcrun simctl create "$simulator_name" "$device_type_id" "$runtime_id" 2>>"$log_path")"; then
  printf 'Simulator creation failed for %s (%s).\n' "$device_type_id" "$runtime_id" >> "$log_path"
  exit 1
fi
if [[ ! "$simulator_udid" =~ ^[A-Fa-f0-9]{8}(-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}$ ]]; then
  printf 'Simulator creation returned an invalid UDID: %s\n' "$simulator_udid" >> "$log_path"
  simulator_udid=''
  exit 1
fi

printf 'Created %s with runtime %s and UDID %s.\n' "$simulator_name" "$runtime_id" "$simulator_udid" >> "$log_path"
if ! xcrun simctl boot "$simulator_udid" >> "$log_path" 2>&1; then
  printf 'Simulator boot request failed for %s.\n' "$simulator_udid" >> "$log_path"
  exit 1
fi

printf '%s\n' "$simulator_udid"
trap - EXIT
