#!/usr/bin/env bash
set -euo pipefail

udid_pattern='^[A-Fa-f0-9]{8}(-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}$'
if [[ $# -eq 5 && "$1" == --identity-file ]]; then
  identity_path="$2"
  log_path="$3"
  target_path="$4"
  worker_ids_path="$5"
  mkdir -p "$(dirname "$log_path")" "$(dirname "$target_path")"
  if [[ ! -s "$identity_path" ]]; then
    printf 'No dedicated Simulator ID was recorded; no device will be targeted.\n' >"$log_path"
    exit 0
  fi
  simulator_identity="$(tr -d '\r\n' <"$identity_path")"
  if [[ ! "$simulator_identity" =~ $udid_pattern ]]; then
    printf 'Dedicated Simulator identity is invalid; no device will be targeted.\n' >"$log_path"
    exit 2
  fi
  # Preserve worker IDs recorded before boot even if post-test inventory collection failed.
  [[ -s "$target_path" ]] || printf '%s\n' "$simulator_identity" >"$target_path"
  if [[ -s "$worker_ids_path" ]]; then cat "$worker_ids_path" >>"$target_path"; fi
  set -- "$simulator_identity" "$log_path" "$target_path"
elif [[ ($# -ne 2 && $# -ne 3) || ! "$1" =~ $udid_pattern ]]; then
  printf 'Usage: %s <simulator-udid> <teardown-log-path> [target-udid-file] | --identity-file <identity-path> <teardown-log-path> <target-udid-file> <worker-udid-file>\n' "$0" >&2
  exit 2
fi

base_udid="$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')"
log_path="$2"
script_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
mkdir -p "$(dirname "$log_path")"
: >"$log_path"

# The inventory file names only this job's base and verified worker clones; never sweep runner-wide devices.
target_udids=("$base_udid")
failure_status=0
if [[ $# -eq 3 ]]; then
  target_path="$3"
  if [[ ! -f "$target_path" ]]; then
    printf 'Simulator target list is missing; cleanup is limited to the dedicated base.\n' | tee -a "$log_path" >&2
    failure_status=1
  else
    while IFS= read -r target_udid || [[ -n "$target_udid" ]]; do
      [[ -n "$target_udid" ]] || continue
      if [[ ! "$target_udid" =~ $udid_pattern ]]; then
        printf 'Invalid Simulator target was ignored: %s\n' "$target_udid" | tee -a "$log_path" >&2
        failure_status=1
        continue
      fi
      target_udid="$(printf '%s' "$target_udid" | tr '[:lower:]' '[:upper:]')"
      duplicate=false
      for existing in "${target_udids[@]}"; do
        if [[ "$existing" == "$target_udid" ]]; then
          duplicate=true
          break
        fi
      done
      if [[ "$duplicate" == false ]]; then target_udids+=("$target_udid"); fi
    done <"$target_path"
  fi
fi

simctl_timeout_ms="${OROT_DETOX_SIMCTL_TIMEOUT_MS:-120000}"
run_simctl() {
  bash "$script_dir/run-detox-simctl.sh" "$simctl_timeout_ms" "$@"
}

all_devices=''
if all_devices="$(run_simctl list devices 2>>"$log_path")"; then
  all_devices_listed=true
  all_devices="$(printf '%s' "$all_devices" | tr '[:lower:]' '[:upper:]')"
else
  all_devices_listed=false
  list_status=$?
  failure_status=$list_status
  printf 'Could not list Simulators before teardown (exit %s); exact listed targets will still be attempted.\n' "$list_status" >>"$log_path"
fi
booted_devices=''
if booted_devices="$(run_simctl list devices booted 2>>"$log_path")"; then
  booted_devices_listed=true
  booted_devices="$(printf '%s' "$booted_devices" | tr '[:lower:]' '[:upper:]')"
else
  booted_devices_listed=false
  list_status=$?
  if [[ "$failure_status" -eq 0 ]]; then failure_status="$list_status"; fi
  printf 'Could not list booted Simulators; exact target shutdowns and deletions will still be attempted.\n' >>"$log_path"
fi

for simulator_udid in "${target_udids[@]}"; do
  if [[ "$all_devices_listed" == true && "$all_devices" != *"$simulator_udid"* ]]; then
    printf 'Dedicated Simulator %s is already absent.\n' "$simulator_udid" >>"$log_path"
    continue
  fi
  if [[ "$booted_devices_listed" == false || "$booted_devices" == *"$simulator_udid"* ]]; then
    if run_simctl shutdown "$simulator_udid" >>"$log_path" 2>&1; then
      :
    else
      shutdown_status=$?
      if [[ "$failure_status" -eq 0 ]]; then failure_status="$shutdown_status"; fi
      printf 'Dedicated Simulator shutdown failed for %s (exit %s); deletion will still be attempted.\n' "$simulator_udid" "$shutdown_status" | tee -a "$log_path" >&2
    fi
  fi
  if run_simctl delete "$simulator_udid" >>"$log_path" 2>&1; then
    :
  else
    delete_status=$?
    if [[ "$failure_status" -eq 0 ]]; then failure_status="$delete_status"; fi
    printf 'Dedicated Simulator deletion failed for %s (exit %s).\n' "$simulator_udid" "$delete_status" | tee -a "$log_path" >&2
  fi
done

remaining_devices=''
if remaining_devices="$(run_simctl list devices 2>>"$log_path")"; then
  remaining_devices="$(printf '%s' "$remaining_devices" | tr '[:lower:]' '[:upper:]')"
  for simulator_udid in "${target_udids[@]}"; do
    if [[ "$remaining_devices" == *"$simulator_udid"* ]]; then
      printf 'Dedicated Simulator %s remains after deletion.\n' "$simulator_udid" | tee -a "$log_path" >&2
      failure_status=1
    fi
  done
else
  verification_status=$?
  if [[ "$failure_status" -eq 0 ]]; then failure_status="$verification_status"; fi
  printf 'Could not verify Simulator deletion (exit %s).\n' "$verification_status" >>"$log_path"
fi

if [[ "$failure_status" -ne 0 ]]; then exit "$failure_status"; fi
worker_count=$((${#target_udids[@]} - 1))
worker_label=Simulators
if [[ "$worker_count" -eq 1 ]]; then
  worker_label=Simulator
fi
printf 'Deleted dedicated Simulator %s and %s worker %s.\n' \
  "${target_udids[0]}" "$worker_count" "$worker_label" | tee -a "$log_path"
