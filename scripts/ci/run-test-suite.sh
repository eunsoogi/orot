#!/usr/bin/env bash
set -uo pipefail

# This wrapper owns only workspace unit execution; integration suites use verified XCTest products and result bundles.
if [[ $# -ne 2 || "$1" != unit ]]; then
  printf 'Usage: %s unit <artifact-directory>\n' "$0" >&2
  exit 2
fi
artifact_dir="$2"
mkdir -p "$artifact_dir"
log_path="$artifact_dir/unit-test.log"
scripts/ci/run-command.sh unit "$log_path" -- pnpm test:unit
command_status=$?
node scripts/ci/require-jest-summary.mjs "$log_path" unit
summary_status=$?
if [[ "$command_status" -ne 0 ]]; then exit "$command_status"; fi
exit "$summary_status"
