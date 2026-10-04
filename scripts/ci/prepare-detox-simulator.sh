#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
  printf 'Usage: %s <setup-log-path> <simulator-identity-path> [both|release|openai-provider]\n' "$0" >&2
  exit 2
fi

log_path="$1"
identity_path="$2"
profile="${3:-both}"
case "$profile" in
  both | release | openai-provider) ;;
  *)
    printf 'Unknown Detox Simulator profile: %s\n' "$profile" >&2
    exit 2
    ;;
esac

script_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
mkdir -p "$(dirname "$log_path")"
mkdir -p "$(dirname "$identity_path")"
: >"$log_path"
: >"$identity_path"

simctl_timeout_ms="${OROT_DETOX_SIMCTL_TIMEOUT_MS:-120000}"
run_simctl() {
  bash "$script_dir/run-detox-simctl.sh" "$simctl_timeout_ms" "$@"
}

runtime_id="$(run_simctl list runtimes --json 2>>"$log_path" | node -e '
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
  trap - EXIT
  if [[ "$result" -ne 0 && -z "$simulator_udid" && -s "$identity_path" ]]; then
    simulator_udid="$(cat "$identity_path")"
  fi
  if [[ "$result" -ne 0 && -n "$simulator_udid" ]]; then
    if run_simctl shutdown "$simulator_udid" >>"$log_path" 2>&1; then
      :
    else
      printf 'Simulator shutdown cleanup failed for %s.\n' "$simulator_udid" >>"$log_path"
    fi
    if run_simctl delete "$simulator_udid" >>"$log_path" 2>&1; then
      :
    else
      printf 'Simulator delete cleanup failed for %s.\n' "$simulator_udid" >>"$log_path"
    fi
  fi
  exit "$result"
}
trap cleanup_on_failure EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

if ! simulator_udid="$(run_simctl create "$simulator_name" "$device_type_id" "$runtime_id" 2>>"$log_path")"; then
  printf 'Simulator creation failed for %s (%s).\n' "$device_type_id" "$runtime_id" >>"$log_path"
  exit 1
fi
if [[ ! "$simulator_udid" =~ ^[A-Fa-f0-9]{8}(-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}$ ]]; then
  printf 'Simulator creation returned an invalid UDID: %s\n' "$simulator_udid" >>"$log_path"
  simulator_udid=''
  exit 1
fi

printf '%s\n' "$simulator_udid" >"$identity_path"
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  printf 'udid=%s\n' "$simulator_udid" >>"$GITHUB_OUTPUT"
fi
if [[ -n "${GITHUB_ENV:-}" ]]; then
  if [[ "$profile" == both || "$profile" == release ]]; then
    printf 'OROT_DETOX_SIMULATOR_UDID=%s\n' "$simulator_udid" >>"$GITHUB_ENV"
  fi
  if [[ "$profile" == both || "$profile" == openai-provider ]]; then
    printf 'OROT_OPENAI_PROVIDER_SIMULATOR_UDID=%s\n' "$simulator_udid" >>"$GITHUB_ENV"
  fi
fi

printf 'Created %s with runtime %s and UDID %s.\n' "$simulator_name" "$runtime_id" "$simulator_udid" >>"$log_path"
if ! run_simctl boot "$simulator_udid" >>"$log_path" 2>&1; then
  printf 'Simulator boot request failed for %s.\n' "$simulator_udid" >>"$log_path"
  exit 1
fi

printf '%s\n' "$simulator_udid"
trap - EXIT INT TERM HUP
