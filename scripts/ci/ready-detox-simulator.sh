#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 4 || ! "$2" =~ ^[A-Fa-f0-9]{8}(-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}$ ]]; then
  printf 'Usage: %s <profile> <simulator-udid> <identity-path> <baseline-inventory-path>\n' "$0" >&2
  exit 2
fi
profile="$1"
udid="$2"
identity_path="$3"
baseline_path="$4"
script_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
case "$profile" in
  release | openai-provider | next-visit-questions)
    exec bash "$script_dir/wait-detox-simulator.sh" "$udid" "$baseline_path"
    ;;
  transcription) ;;
  *) exit 2 ;;
esac

# Boot only the freshly created CI Speech device after host preparation. A smaller
# device is a measured candidate, not a memory guarantee or permission to disable services.
if [[ "${GITHUB_ACTIONS:-}" != true || ! "${GITHUB_RUN_ID:-}" =~ ^[0-9]+$ ||
  ! "${GITHUB_RUN_ATTEMPT:-}" =~ ^[0-9]+$ || ! -s "$identity_path" ||
  "$(tr -d '\r\n' <"$identity_path")" != "$udid" ]]; then
  printf 'Speech boot requires this Actions run\047s recorded Simulator identity.\n' >&2
  exit 1
fi

# Inventory validation precedes bootstatus because bootstatus -b can itself boot a device.
bash "$script_dir/run-detox-simctl.sh" 120000 list devices --json | node -e '
const fs = require("node:fs");
const data = JSON.parse(fs.readFileSync(0, "utf8"));
const [udid] = process.argv.slice(1);
const env = process.env;
const runtime = env.EXPECTED_IOS_SIMULATOR_RUNTIME_IDENTIFIER;
const type = env.EXPECTED_DETOX_SIMULATOR_DEVICE_TYPE_ID;
const devices = Object.entries(data.devices).flatMap(([key, entries]) =>
  entries.filter((device) => device.udid === udid).map((device) => ({ ...device, runtime: key })));
const prefix = "Orot Detox CI " + env.GITHUB_RUN_ID + "-" + env.GITHUB_RUN_ATTEMPT + "-";
const device = devices[0];
if (!runtime || !type || devices.length !== 1 || device.runtime !== runtime ||
    device.deviceTypeIdentifier !== type || !device.isAvailable ||
    device.state !== "Shutdown" || !device.name.startsWith(prefix) ||
    !/^\d+$/.test(device.name.slice(prefix.length))) {
  throw new Error("Speech boot target is not this runs available dedicated profile device");
}
' "$udid"

observe_memory() {
  # Observational host metrics are retained in the boot log; unavailable metrics never certify readiness.
  printf '\nSpeech Simulator memory %s at %s\n' "$1" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  vm_stat || true
  sysctl vm.swapusage || true
}

observe_memory before-boot
bash "$script_dir/run-detox-simctl.sh" 120000 boot "$udid"
# Baseline inventory is captured only after the one late boot, preserving clone cleanup semantics.
bash "$script_dir/wait-detox-simulator.sh" "$udid" "$baseline_path"
observe_memory after-boot
