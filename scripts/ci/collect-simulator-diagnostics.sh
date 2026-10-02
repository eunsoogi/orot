#!/usr/bin/env bash
set -uo pipefail

if [[ $# -ne 2 ]]; then
  printf 'Usage: %s <detox-test-log> <output-log>\n' "$0" >&2
  exit 2
fi

test_log="$1"
output_log="$2"
mkdir -p "$(dirname "$output_log")"
device_id="$(sed -n 's/.*assigned to \([A-Fa-f0-9-]*\) (iPhone 18 Pro).*/\1/p' "$test_log" | tail -n 1)"
if [[ -z "$device_id" ]]; then
  printf 'Detox did not report an iPhone 18 Pro simulator ID; see the retained Detox test log.\n' > "$output_log"
  exit 0
fi

if ! xcrun simctl spawn "$device_id" log show --last 20m --style compact --predicate 'process == "OrotMobile"' > "$output_log" 2>&1; then
  printf '\nSimulator log capture failed; see the retained Detox test log.\n' >> "$output_log"
fi
