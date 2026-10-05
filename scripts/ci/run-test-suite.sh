#!/usr/bin/env bash
set -uo pipefail

if [[ $# -ne 2 ]]; then
  printf 'Usage: %s <unit|e2e|e2e-release|e2e-openai-provider> <artifact-directory>\n' "$0" >&2
  exit 2
fi

suite="$1"
artifact_dir="$2"
mkdir -p "$artifact_dir"
artifact_dir="$(cd "$artifact_dir" && pwd -P)"
resource_log_arg=
resource_sampling="${OROT_DETOX_RESOURCE_SAMPLING:-false}"
case "$resource_sampling" in
  true)
    resource_log_arg="OROT_DETOX_RESOURCE_LOG_PATH=$artifact_dir/detox-resource-samples.log"
    ;;
  false | '')
    resource_sampling=false
    ;;
  *)
    printf 'OROT_DETOX_RESOURCE_SAMPLING must be true or false.\n' >&2
    exit 2
    ;;
esac
case "$suite" in
  unit)
    log_path="$artifact_dir/unit-test.log"
    command=(pnpm test:unit)
    ;;
  e2e)
    log_path="$artifact_dir/e2e-test.log"
    command=(env
      "DETOX_ARTIFACTS_LOCATION=$artifact_dir/detox"
      DETOX_RECORD_LOGS=failing
      DETOX_RECORD_VIDEOS=none
      DETOX_CAPTURE_VIEW_HIERARCHY=enabled
      DETOX_HEADLESS=true)
    command+=("OROT_DETOX_RESOURCE_SAMPLING=$resource_sampling" OROT_DETOX_RESOURCE_LOG_PATH=)
    if [[ -n "$resource_log_arg" ]]; then command+=("$resource_log_arg"); fi
    command+=(bash scripts/ci/run-detox-e2e.sh both)
    ;;
  e2e-release)
    log_path="$artifact_dir/e2e-test.log"
    command=(env
      "DETOX_ARTIFACTS_LOCATION=$artifact_dir/detox"
      DETOX_RECORD_LOGS=failing
      DETOX_RECORD_VIDEOS=none
      DETOX_CAPTURE_VIEW_HIERARCHY=enabled
      DETOX_HEADLESS=true
      "OROT_DETOX_RESOURCE_SAMPLING=$resource_sampling"
      OROT_DETOX_RESOURCE_LOG_PATH=)
    if [[ -n "$resource_log_arg" ]]; then command+=("$resource_log_arg"); fi
    command+=(bash scripts/ci/run-detox-e2e.sh release)
    ;;
  e2e-openai-provider)
    log_path="$artifact_dir/e2e-test.log"
    command=(env
      "DETOX_ARTIFACTS_LOCATION=$artifact_dir/detox"
      DETOX_RECORD_LOGS=failing
      DETOX_RECORD_VIDEOS=none
      DETOX_CAPTURE_VIEW_HIERARCHY=enabled
      DETOX_HEADLESS=true)
    command+=("OROT_DETOX_RESOURCE_SAMPLING=$resource_sampling" OROT_DETOX_RESOURCE_LOG_PATH=)
    if [[ -n "$resource_log_arg" ]]; then command+=("$resource_log_arg"); fi
    command+=(bash scripts/ci/run-detox-e2e.sh openai-provider)
    ;;
  *)
    printf 'Unknown test suite: %s\n' "$suite" >&2
    exit 2
    ;;
esac

set +e
scripts/ci/run-command.sh "$suite" "$log_path" -- "${command[@]}"
command_status=$?
summary_args=("$log_path" "$suite")
if [[ ("$suite" == e2e-release || "$suite" == e2e-openai-provider) && -n "${GITHUB_OUTPUT:-}" ]]; then
  summary_args+=("$GITHUB_OUTPUT")
fi
node scripts/ci/require-jest-summary.mjs "${summary_args[@]}"
summary_status=$?
set -e

if [[ "$command_status" -ne 0 ]]; then
  exit "$command_status"
fi
exit "$summary_status"
