#!/usr/bin/env bash
set -euo pipefail

# Record public Xcode runner controls without synthesizing Face ID input.
xcodebuild -version
xcrun simctl help
xcrun simctl help io

simulator_apps=''
for applications in "${DEVELOPER_DIR:?}/Applications" "${DEVELOPER_DIR}/../Applications"; do
  [[ -d "$applications" ]] || continue
  found_apps="$(find "$applications" -maxdepth 3 \( -name 'Simulator.app' -o -name 'DeviceHub.app' \) -print)"
  if [[ -n "$found_apps" ]]; then
    simulator_apps+="${simulator_apps:+$'\n'}$found_apps"
  fi
done

if [[ -n "$simulator_apps" ]]; then
  printf 'SIMULATOR_GUI_APP=%s\n' "$simulator_apps"
else
  printf 'SIMULATOR_GUI_APP=absent\n'
fi
