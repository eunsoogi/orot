#!/usr/bin/env bash
set -euo pipefail

if [[ $# != 6 ]]; then
  printf 'Usage: %s <profile> <mode> <identifier> <xctestrun> <owner-file> <output-directory>\n' "$0" >&2
  exit 2
fi
profile="$1"
mode="$2"
test_id="$3"
test_run="$4"
owner_file="$5"
directory="$6"

# Both hosted callers provide an already verified product and booted owned destination.
# Selection is exact; stateful groups keep their original phase drivers and first-failure boundary.
case "$mode" in
  backup | local-model | speech-journey | fixture-isolation | recording-persistence | state-persistence)
    scripts/ci/run-command.sh ios-focus-tests "$directory/tests.log" -- node "scripts/ci/run-ios-$mode-tests.mjs" "$test_run" "$owner_file" "$directory/$mode"
    ;;
  authentication)
    # Run both protected queries in the same suite so neither assertion becomes an optional single-case focus.
    node scripts/ci/ios-simulator-biometric-control.mjs run "$profile" "$test_run" "$owner_file" "$directory"
    node scripts/ci/ios-test-results.mjs "$profile" "$directory/results.xcresult" "$directory/results.json"
    ;;
  fixture)
    set -- "$profile" "$test_run" "$owner_file" "$directory/fixtures"
    if [[ -n "$test_id" ]]; then set -- "$@" "$test_id"; fi
    scripts/ci/run-command.sh ios-focus-tests "$directory/tests.log" -- node scripts/ci/run-ios-fixture-tests.mjs "$@"
    ;;
  plain)
    test -n "$test_id"
    scripts/ci/run-command.sh ios-focus-tests "$directory/tests.log" -- node scripts/ci/run-ios-tests.mjs "$profile" "$test_run" "$owner_file" "$directory/results.xcresult" "$test_id"
    node scripts/ci/ios-test-results.mjs "$profile" "$directory/results.xcresult" "$directory/results.json" "$test_id"
    ;;
  *)
    printf 'Unknown focused execution mode: %s\n' "$mode" >&2
    exit 2
    ;;
esac
