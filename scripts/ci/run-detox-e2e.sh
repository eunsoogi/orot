#!/usr/bin/env bash
set -euo pipefail

if [[ $# -gt 1 ]]; then
  printf 'Usage: %s [both|release|openai-provider]\n' "$0" >&2
  exit 2
fi
profile="${1:-both}"
case "$profile" in
  both|release|openai-provider) ;;
  *) printf 'Unknown Detox test profile: %s\nUsage: %s [both|release|openai-provider]\n' "$profile" "$0" >&2; exit 2 ;;
esac

if [[ -z "${DETOX_ARTIFACTS_LOCATION:-}" ]]; then
  printf 'DETOX_ARTIFACTS_LOCATION is required.\n' >&2
  exit 2
fi

release_simulator_id="${OROT_DETOX_SIMULATOR_UDID:-}"
debug_simulator_id="${OROT_OPENAI_PROVIDER_SIMULATOR_UDID:-}"
valid_udid_re='^[A-Fa-f0-9]{8}(-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}$'
if [[ "$profile" == both || "$profile" == release ]]; then
  if [[ ! "$release_simulator_id" =~ $valid_udid_re ]]; then
    printf 'A dedicated Release Detox Simulator UDID is required.\n' >&2
    exit 2
  fi
fi
if [[ "$profile" == both || "$profile" == openai-provider ]]; then
  if [[ ! "$debug_simulator_id" =~ $valid_udid_re ]]; then
    printf 'A dedicated OpenAI Debug Detox Simulator UDID is required.\n' >&2
    exit 2
  fi
fi
if [[ "$profile" == both && "$release_simulator_id" != "$debug_simulator_id" ]]; then
  printf 'Local combined E2E must use the same dedicated Simulator for both configurations.\n' >&2
  exit 2
fi

log_level="${OROT_DETOX_TEST_LOG_LEVEL:-info}"
case "$log_level" in
  fatal|error|warn|info|verbose|debug|trace) ;;
  *) printf 'Unsupported Detox log level: %s\n' "$log_level" >&2; exit 2 ;;
esac

resource_sampling="${OROT_DETOX_RESOURCE_SAMPLING:-false}"
case "$resource_sampling" in
  true)
    resource_log="${OROT_DETOX_RESOURCE_LOG_PATH:-$DETOX_ARTIFACTS_LOCATION/detox-resource-samples.log}"
    ;;
  false|'')
    resource_log=
    ;;
  *)
    printf 'OROT_DETOX_RESOURCE_SAMPLING must be true or false.\n' >&2
    exit 2
    ;;
esac
if [[ -n "$resource_log" ]]; then
  mkdir -p "$(dirname "$resource_log")"
  : >> "$resource_log"
fi

sample_processes() {
  local name="$1"
  local phase="$2"
  local sample_index="$3"
  [[ -n "$resource_log" ]] || return 0
  {
    printf 'DETOX_RESOURCE_SAMPLE profile=%s phase=%s sample=%s utc=%s\n' \
      "$name" "$phase" "$sample_index" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    printf 'DETOX_PS_PROCESS_SAMPLE percent_cpu=lifetime-average rss_kib=resident-size\n'
    ps -A -o pid= -o ppid= -o %cpu= -o rss= -o etime= -o comm= \
      | awk 'tolower($0) ~ /(node|pnpm|jest|detox|simulator|coresimulator|orot)/' || true
    if [[ "$phase" != running || "$sample_index" == 0 || $((sample_index % 4)) -eq 0 ]]; then
      if [[ "$(uname -s)" == Darwin ]]; then
        printf 'DETOX_TOP_SAMPLE cpu_is_delta_between_two_samples interval_seconds=1 utc=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
        top -d -l 2 -s 1 -n 25 -o cpu -stats pid,command,cpu,mem 2>/dev/null \
          | awk 'BEGIN { sample = 0 } /^Processes:/ { sample += 1 } sample == 2 { print }' || true
        printf 'DETOX_MEMORY_COUNTER_SAMPLE source=vm_stat_and_swapusage utc=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
        vm_stat || true
        sysctl vm.swapusage 2>/dev/null || true
      fi
    fi
  } >> "$resource_log"
}

run_profile() {
  local name="$1"
  local simulator_id="$2"
  local artifact_name="$3"
  shift 3
  local started_epoch
  started_epoch="$(date +%s)"
  local process_id
  local sample_index=0
  local sample_elapsed=0
  local resource_sample_limit=4
  local status=0

  mkdir -p "$DETOX_ARTIFACTS_LOCATION/$artifact_name"
  printf 'DETOX_PROFILE_START profile=%s simulator=%s utc=%s loglevel=%s\n' \
    "$name" "$simulator_id" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$log_level"
  if [[ -z "$resource_log" ]]; then
    if /usr/bin/time -l "$@"; then
      status=0
    else
      status=$?
    fi
  else
    sample_processes "$name" before 0
    /usr/bin/time -l "$@" &
    process_id=$!
    sample_elapsed=0
    while kill -0 "$process_id" 2>/dev/null; do
      process_state="$(ps -p "$process_id" -o stat= 2>/dev/null || true)"
      if [[ -z "$process_state" || "$process_state" == *Z* ]]; then
        break
      fi
      sleep 1
      sample_elapsed=$((sample_elapsed + 1))
      if kill -0 "$process_id" 2>/dev/null \
        && (( sample_elapsed >= 15 )) \
        && (( sample_index < resource_sample_limit )); then
        sample_index=$((sample_index + 1))
        sample_processes "$name" running "$sample_index"
        sample_elapsed=0
      fi
    done
    wait "$process_id" || status=$?
  fi
  printf 'DETOX_PROFILE_END profile=%s status=%s elapsed_seconds=%s utc=%s\n' \
    "$name" "$status" "$(( $(date +%s) - started_epoch ))" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  if [[ -n "$resource_log" ]]; then sample_processes "$name" after "$sample_index"; fi
  return "$status"
}

run_profile_for_configuration() {
  local name="$1"
  local simulator_id="$2"
  local artifact_name="$3"
  shift 3
  export OROT_DETOX_TEST_PROFILE="$name"
  run_profile "$name" "$simulator_id" "$artifact_name" \
    pnpm --filter @orot/mobile exec -- detox test \
      --config-path ../../scripts/ci/detox-e2e-profile.detox.config.cjs \
      "$@" \
      --loglevel "$log_level" \
      --artifacts-location "$DETOX_ARTIFACTS_LOCATION/$artifact_name"
}

release_status=0
debug_status=0

if [[ "$profile" == both || "$profile" == release ]]; then
  run_profile_for_configuration release "$release_simulator_id" release \
    --configuration ios.sim.release || release_status=$?
fi

if [[ "$profile" == both || "$profile" == openai-provider ]]; then
  run_profile_for_configuration openai-provider "$debug_simulator_id" openai-provider \
    --configuration ios.sim.debug.openai-provider || debug_status=$?
fi

if [[ "$release_status" -ne 0 || "$debug_status" -ne 0 ]]; then
  printf 'Detox suite failure: Release exit %s; OpenAI Debug exit %s.\n' "$release_status" "$debug_status" >&2
  exit 1
fi
