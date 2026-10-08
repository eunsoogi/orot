#!/usr/bin/env bash
set -uo pipefail

if [[ $# -ne 2 && $# -ne 3 && $# -ne 6 ]]; then
  printf 'Usage: %s <detox-test-log> <output-log> [simulator-identity-path] [profile baseline-json targets-path]\n' "$0" >&2
  exit 2
fi

test_log="$1"
output_log="$2"
identity_path="${3:-}"
script_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
output_directory="$(dirname "$output_log")"
mkdir -p "$output_directory"

device_id=''
if [[ -n "$identity_path" && -s "$identity_path" ]]; then
  device_id="$(tr -d '\r\n' <"$identity_path")"
fi
if [[ -z "$device_id" && -n "${OROT_DETOX_SIMULATOR_UDID:-}" ]]; then
  device_id="$OROT_DETOX_SIMULATOR_UDID"
fi
if [[ -z "$device_id" && -f "$test_log" ]]; then
  device_id="$(sed -nE 's/.*assigned to ([A-Fa-f0-9-]{36})([[:space:]].*)?$/\1/p' "$test_log" | tail -n 1)"
fi
if [[ ! "$device_id" =~ ^[A-Fa-f0-9]{8}(-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}$ ]]; then
  if [[ ! -f "$test_log" ]]; then
    printf 'Detox test log was not created and no dedicated Simulator ID was recorded.\n' >"$output_log"
  else
    printf 'No dedicated Simulator ID was recorded; see the retained Detox test log.\n' >"$output_log"
  fi
  exit 0
fi

device_id="$(printf '%s' "$device_id" | tr '[:lower:]' '[:upper:]')"
target_ids=("$device_id")
failure_status=0

if [[ $# -eq 6 ]]; then
  profile="$4"
  baseline_path="$5"
  target_path="$6"
  case "$profile" in
    release | openai-provider | transcription) ;;
    *)
      printf 'Unknown Detox Simulator profile: %s\n' "$profile" >&2
      exit 2
      ;;
  esac

  # Preserve the base cleanup target even when inventory capture or validation fails.
  mkdir -p "$(dirname "$target_path")"
  printf '%s\n' "$device_id" >"$target_path"
  current_path="$output_directory/simulator-inventory-current.json"
  inventory_log="$output_directory/simulator-inventory.log"
  if ! bash "$script_dir/run-detox-simctl.sh" "${OROT_DETOX_SIMCTL_TIMEOUT_MS:-120000}" list devices --json >"$current_path" 2>"$inventory_log"; then
    printf 'Could not capture the post-Detox Simulator inventory; only the dedicated base is safe to target.\n' >>"$inventory_log"
    failure_status=1
  elif ! EXPECTED_IOS_SIMULATOR_RUNTIME_IDENTIFIER="${EXPECTED_IOS_SIMULATOR_RUNTIME_IDENTIFIER:-}" \
    EXPECTED_DETOX_SIMULATOR_DEVICE_TYPE_ID="${EXPECTED_DETOX_SIMULATOR_DEVICE_TYPE_ID:-}" \
    node "$script_dir/detox-simulator-inventory.mjs" \
    "$baseline_path" "$current_path" "$test_log" "$device_id" "$profile" "$target_path" \
    >>"$inventory_log" 2>&1; then
    failure_status=1
  fi

  if [[ ! -s "$target_path" ]]; then
    printf '%s\n' "$device_id" >"$target_path"
    failure_status=1
  fi
  target_ids=("$device_id")
  while IFS= read -r candidate || [[ -n "$candidate" ]]; do
    [[ -n "$candidate" ]] || continue
    if [[ ! "$candidate" =~ ^[A-Fa-f0-9]{8}(-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}$ ]]; then
      printf 'Invalid Simulator cleanup target was ignored: %s\n' "$candidate" >>"$inventory_log"
      failure_status=1
      continue
    fi
    candidate="$(printf '%s' "$candidate" | tr '[:lower:]' '[:upper:]')"
    duplicate=false
    for existing in "${target_ids[@]}"; do
      if [[ "$existing" == "$candidate" ]]; then
        duplicate=true
        break
      fi
    done
    if [[ "$duplicate" == false ]]; then target_ids+=("$candidate"); fi
  done <"$target_path"
fi

# Capture each verified worker in parallel so diagnostics cannot consume the cleanup step's full timeout.
mkdir -p "$output_directory/simulator-workers"
capture_pids=()
for target_id in "${target_ids[@]}"; do
  target_log="$output_directory/simulator-workers/$target_id.log"
  if [[ "$target_id" == "$device_id" ]]; then target_log="$output_log"; fi
  (
    if ! bash "$script_dir/run-detox-simctl.sh" "${OROT_DETOX_SIMULATOR_LOG_TIMEOUT_MS:-120000}" \
      spawn "$target_id" log show --last 20m --style compact --predicate 'process == "Orot"' >"$target_log" 2>&1; then
      printf '\nSimulator log capture failed for %s; see the retained Detox test log.\n' "$target_id" >>"$target_log"
      exit 1
    fi
  ) &
  capture_pids+=("$!")
done
for capture_pid in "${capture_pids[@]}"; do
  if wait "$capture_pid"; then :; else failure_status=1; fi
done

exit "$failure_status"
