#!/usr/bin/env bash
set -euo pipefail

# Record public Xcode runner controls without synthesizing Face ID input.
xcodebuild -version
xcrun simctl help
xcrun simctl help io

developer_applications="${DEVELOPER_DIR:?}/Applications"
if [[ -d "$developer_applications" ]]; then
  simulator_apps="$(find "$developer_applications" -maxdepth 3 -name 'Simulator.app' -print -o -name 'DeviceHub.app' -print)"
else
  simulator_apps=''
fi

if [[ -n "$simulator_apps" ]]; then
  printf 'SIMULATOR_GUI_APP=%s\n' "$simulator_apps"
else
  printf 'SIMULATOR_GUI_APP=absent\n'
fi
