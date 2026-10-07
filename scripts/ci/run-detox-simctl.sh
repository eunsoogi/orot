#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  printf 'Usage: %s <timeout-ms> <simctl arguments...>\n' "$0" >&2
  exit 2
fi

timeout_ms="$1"
shift
script_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
exec node "$script_dir/run-detox-simctl.mjs" "$timeout_ms" "$@"
