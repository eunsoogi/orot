#!/usr/bin/env bash
set -uo pipefail

if [[ $# -lt 4 || "$3" != "--" ]]; then
  printf 'Usage: %s <step-name> <log-path> -- <command> [args...]\n' "$0" >&2
  exit 2
fi

step_name="$1"
log_path="$2"
shift 3
mkdir -p "$(dirname "$log_path")"
: >"$log_path"
printf 'Running %s\n' "$step_name"

set +e
"$@" 2>&1 | tee "$log_path"
command_status=${PIPESTATUS[0]}
set -e
exit "$command_status"
