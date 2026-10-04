#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 || ! "$1" =~ ^[A-Fa-f0-9]{8}(-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}$ ]]; then
  printf 'Usage: %s <simulator-udid> <teardown-log-path>\n' "$0" >&2
  exit 2
fi

simulator_udid="$1"
log_path="$2"
script_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
mkdir -p "$(dirname "$log_path")"
: > "$log_path"

simctl_timeout_ms="${OROT_DETOX_SIMCTL_TIMEOUT_MS:-120000}"
run_simctl() {
  bash "$script_dir/run-detox-simctl.sh" "$simctl_timeout_ms" "$@"
}

failure_status=0
if all_devices="$(run_simctl list devices 2>>"$log_path")"; then
  :
else
  failure_status=$?
  printf 'Could not list Simulators before teardown (exit %s).\n' "$failure_status" >> "$log_path"
fi
if [[ "$failure_status" -eq 0 && "$all_devices" != *"$simulator_udid"* ]]; then
  printf 'Dedicated Simulator %s is already absent.\n' "$simulator_udid" | tee -a "$log_path"
  exit 0
fi

booted_devices=''
if booted_devices="$(run_simctl list devices booted 2>>"$log_path")"; then
  if [[ "$booted_devices" == *"$simulator_udid"* ]]; then
    if run_simctl shutdown "$simulator_udid" >> "$log_path" 2>&1; then
      :
    else
      failure_status=$?
      printf 'Dedicated Simulator shutdown failed (exit %s); deletion will still be attempted.\n' "$failure_status" | tee -a "$log_path" >&2
    fi
  fi
else
  list_status=$?
  if [[ "$failure_status" -eq 0 ]]; then failure_status="$list_status"; fi
  printf 'Could not list booted Simulators; shutdown and deletion will still be attempted.\n' | tee -a "$log_path" >&2
  if run_simctl shutdown "$simulator_udid" >> "$log_path" 2>&1; then
    :
  else
    shutdown_status=$?
    if [[ "$failure_status" -eq 0 ]]; then failure_status="$shutdown_status"; fi
    printf 'Dedicated Simulator shutdown failed (exit %s); deletion will still be attempted.\n' "$shutdown_status" | tee -a "$log_path" >&2
  fi
fi

if run_simctl delete "$simulator_udid" >> "$log_path" 2>&1; then
  :
else
  delete_status=$?
  if [[ "$failure_status" -eq 0 ]]; then failure_status="$delete_status"; fi
  printf 'Dedicated Simulator deletion failed (exit %s).\n' "$delete_status" | tee -a "$log_path" >&2
fi

if all_devices="$(run_simctl list devices 2>>"$log_path")"; then
  if [[ "$all_devices" == *"$simulator_udid"* ]]; then
    printf 'Dedicated Simulator %s remains after deletion.\n' "$simulator_udid" | tee -a "$log_path" >&2
    exit 1
  fi
else
  verification_status=$?
  if [[ "$failure_status" -eq 0 ]]; then failure_status="$verification_status"; fi
  printf 'Could not verify Simulator deletion (exit %s).\n' "$verification_status" | tee -a "$log_path" >&2
fi

if [[ "$failure_status" -ne 0 ]]; then
  exit "$failure_status"
fi
printf 'Deleted dedicated Simulator %s.\n' "$simulator_udid" | tee -a "$log_path"
