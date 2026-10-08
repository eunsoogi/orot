#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  printf 'Usage: %s <setup-log-path> <worker-simulator-id-path>\n' "$0" >&2
  exit 2
fi

log_path="$1"
identity_path="$2"
script_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
mkdir -p "$(dirname "$log_path")" "$(dirname "$identity_path")"
: >"$log_path"
: >"$identity_path"

base_udid="${OROT_DETOX_SIMULATOR_UDID:-}"
runtime_id="${EXPECTED_IOS_SIMULATOR_RUNTIME_IDENTIFIER:-}"
device_type_id="${EXPECTED_DETOX_SIMULATOR_DEVICE_TYPE_ID:-}"
udid_pattern='^[A-Fa-f0-9]{8}(-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}$'
if [[ ! "$base_udid" =~ $udid_pattern || -z "$runtime_id" || -z "$device_type_id" ]]; then
  printf 'A dedicated base Simulator, runtime, and device type are required.\n' >&2
  exit 2
fi

simctl_timeout_ms="${OROT_DETOX_SIMCTL_TIMEOUT_MS:-120000}"
run_simctl() {
  bash "$script_dir/run-detox-simctl.sh" "$simctl_timeout_ms" "$@"
}

# Record each explicit worker before boot so the always-run teardown can remove it after any later failure.
create_worker() {
  local label="$1"
  local variable="$2"
  local simulator_name="Orot Detox CI ${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1} Release ${label}"
  local simulator_udid
  local normalized_udid
  local normalized_base_udid
  if ! simulator_udid="$(run_simctl create "$simulator_name" "$device_type_id" "$runtime_id" 2>>"$log_path")"; then
    printf 'Could not create the dedicated Release %s Simulator.\n' "$label" >>"$log_path"
    return 1
  fi
  normalized_udid="$(printf '%s' "$simulator_udid" | tr '[:lower:]' '[:upper:]')"
  normalized_base_udid="$(printf '%s' "$base_udid" | tr '[:lower:]' '[:upper:]')"
  if [[ ! "$simulator_udid" =~ $udid_pattern || "$normalized_udid" == "$normalized_base_udid" ]]; then
    printf 'Release %s Simulator creation returned an invalid or reused UDID: %s\n' "$label" "$simulator_udid" >>"$log_path"
    return 1
  fi
  simulator_udid="$normalized_udid"
  if grep -Fqx "$simulator_udid" "$identity_path"; then
    printf 'Release Simulator creation repeated UDID %s.\n' "$simulator_udid" >>"$log_path"
    return 1
  fi
  printf '%s\n' "$simulator_udid" >>"$identity_path"
  if [[ -n "${GITHUB_ENV:-}" ]]; then printf '%s=%s\n' "$variable" "$simulator_udid" >>"$GITHUB_ENV"; fi
  printf 'Created dedicated Release %s Simulator %s for %s (%s).\n' \
    "$label" "$simulator_udid" "$device_type_id" "$runtime_id" >>"$log_path"
  created_udid="$simulator_udid"
}

create_worker data OROT_DETOX_RELEASE_DATA_SIMULATOR_UDID
data_udid="$created_udid"
create_worker storage OROT_DETOX_RELEASE_STORAGE_SIMULATOR_UDID
storage_udid="$created_udid"

# Create and record both targets before booting either so teardown can recover from either boot failure.
{
  run_simctl boot "$data_udid"
  run_simctl bootstatus "$data_udid" -b
  run_simctl boot "$storage_udid"
  run_simctl bootstatus "$storage_udid" -b
} >>"$log_path" 2>&1
if [[ -n "${GITHUB_ENV:-}" ]]; then printf 'OROT_DETOX_RELEASE_SHARDING=true\n' >>"$GITHUB_ENV"; fi
printf 'Prepared two dedicated Release worker Simulators.\n' >>"$log_path"
