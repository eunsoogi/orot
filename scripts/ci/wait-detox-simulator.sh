#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 || ! "$1" =~ ^[A-Fa-f0-9]{8}(-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}$ ]]; then
  printf 'Usage: %s <simulator-udid> [baseline-inventory-path]\n' "$0" >&2
  exit 2
fi

script_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
simctl_timeout_ms="${OROT_DETOX_SIMCTL_TIMEOUT_MS:-900000}"
bash "$script_dir/run-detox-simctl.sh" "$simctl_timeout_ms" bootstatus "$1" -b
if [[ $# -eq 2 ]]; then
  # Snapshot after boot and before Detox so cleanup can distinguish this job's clones from existing devices.
  mkdir -p "$(dirname "$2")"
  bash "$script_dir/run-detox-simctl.sh" "$simctl_timeout_ms" list devices --json >"$2"
fi
