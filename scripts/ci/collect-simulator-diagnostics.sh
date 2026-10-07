#!/usr/bin/env bash
set -uo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
  printf 'Usage: %s <detox-test-log> <output-log> [simulator-identity-path]\n' "$0" >&2
  exit 2
fi

test_log="$1"
output_log="$2"
identity_path="${3:-}"
script_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
mkdir -p "$(dirname "$output_log")"

device_id=''
if [[ -n "$identity_path" && -s "$identity_path" ]]; then
  device_id="$(cat "$identity_path")"
fi
if [[ -z "$device_id" && -n "${OROT_DETOX_SIMULATOR_UDID:-}" ]]; then
  device_id="$OROT_DETOX_SIMULATOR_UDID"
fi
if [[ -z "$device_id" && -f "$test_log" ]]; then
  device_id="$(sed -nE 's/.*assigned to ([A-Fa-f0-9-]{36})([[:space:]].*)?$/\1/p' "$test_log" | tail -n 1)"
fi
if [[ -z "$device_id" ]]; then
  if [[ ! -f "$test_log" ]]; then
    printf 'Detox test log was not created and no dedicated Simulator ID was recorded.\n' >"$output_log"
  else
    printf 'No dedicated Simulator ID was recorded; see the retained Detox test log.\n' >"$output_log"
  fi
  exit 0
fi

if ! bash "$script_dir/run-detox-simctl.sh" "${OROT_DETOX_SIMULATOR_LOG_TIMEOUT_MS:-120000}" spawn "$device_id" log show --last 20m --style compact --predicate 'process == "Orot"' >"$output_log" 2>&1; then
  printf '\nSimulator log capture failed; see the retained Detox test log.\n' >>"$output_log"
fi
