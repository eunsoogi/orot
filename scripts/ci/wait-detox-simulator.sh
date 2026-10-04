#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! "$1" =~ ^[A-Fa-f0-9]{8}(-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}$ ]]; then
  printf 'Usage: %s <simulator-udid>\n' "$0" >&2
  exit 2
fi

script_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
bash "$script_dir/run-detox-simctl.sh" "${OROT_DETOX_SIMCTL_TIMEOUT_MS:-900000}" bootstatus "$1" -b
