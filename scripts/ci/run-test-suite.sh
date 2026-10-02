#!/usr/bin/env bash
set -uo pipefail

if [[ $# -ne 2 ]]; then
  printf 'Usage: %s <unit|e2e> <artifact-directory>\n' "$0" >&2
  exit 2
fi

suite="$1"
artifact_dir="$2"
mkdir -p "$artifact_dir"
artifact_dir="$(cd "$artifact_dir" && pwd -P)"
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
      DETOX_TAKE_SCREENSHOTS=failing
      DETOX_RECORD_VIDEOS=failing
      DETOX_CAPTURE_VIEW_HIERARCHY=enabled
      DETOX_HEADLESS=true
      pnpm e2e:test:ios)
    ;;
  *)
    printf 'Unknown test suite: %s\n' "$suite" >&2
    exit 2
    ;;
esac

set +e
scripts/ci/run-command.sh "$suite" "$log_path" -- "${command[@]}"
command_status=$?
node scripts/ci/require-jest-summary.mjs "$log_path" "$suite"
summary_status=$?
set -e

if [[ "$command_status" -ne 0 ]]; then
  exit "$command_status"
fi
exit "$summary_status"
