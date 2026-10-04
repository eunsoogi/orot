#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 || ! "$1" =~ ^[A-Fa-f0-9]{8}(-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}$ ]]; then
  printf 'Usage: %s <simulator-udid> <teardown-log-path>\n' "$0" >&2
  exit 2
fi

simulator_udid="$1"
log_path="$2"
mkdir -p "$(dirname "$log_path")"
: > "$log_path"

all_devices="$(xcrun simctl list devices 2>>"$log_path")"
if [[ "$all_devices" != *"$simulator_udid"* ]]; then
  printf 'Dedicated Simulator %s is already absent.\n' "$simulator_udid" | tee -a "$log_path"
  exit 0
fi

booted_devices="$(xcrun simctl list devices booted 2>>"$log_path")"
if [[ "$booted_devices" == *"$simulator_udid"* ]]; then
  xcrun simctl shutdown "$simulator_udid" >> "$log_path" 2>&1
fi
xcrun simctl delete "$simulator_udid" >> "$log_path" 2>&1

all_devices="$(xcrun simctl list devices 2>>"$log_path")"
if [[ "$all_devices" == *"$simulator_udid"* ]]; then
  printf 'Dedicated Simulator %s remains after deletion.\n' "$simulator_udid" | tee -a "$log_path" >&2
  exit 1
fi
printf 'Deleted dedicated Simulator %s.\n' "$simulator_udid" | tee -a "$log_path"
