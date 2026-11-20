#!/usr/bin/env bash
set -uo pipefail

if [[ $# -ne 2 ]]; then
  printf 'Usage: %s <unit|packages|mobile-1|mobile-2|mobile-3> <artifact-directory>\n' "$0" >&2
  exit 2
fi

case "$1" in
  unit) command=(pnpm test:unit); expected_runs=10 ;;
  packages) command=(pnpm test:unit:packages); expected_runs=9 ;;
  mobile-[1-3]) command=(pnpm --filter @orot/mobile test:unit "--shard=${1#mobile-}/3"); expected_runs=1 ;;
  *) printf 'Unknown unit lane: %s\n' "$1" >&2; exit 2 ;;
esac

artifact_dir="$2"
mkdir -p "$artifact_dir"
log_path="$artifact_dir/unit-test.log"
scripts/ci/run-command.sh unit "$log_path" -- "${command[@]}"
command_status=$?
node scripts/ci/require-jest-summary.mjs "$log_path" unit "$expected_runs"
summary_status=$?
if [[ "$command_status" -ne 0 ]]; then exit "$command_status"; fi
exit "$summary_status"
