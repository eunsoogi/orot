#!/usr/bin/env bash
set -euo pipefail

brew tap wix/brew
brew install applesimutils

expected_output="applesimutils version ${EXPECTED_APPLESIMUTILS_VERSION:-0.9.12}"
actual_output="$(applesimutils --version)"
if [[ "$actual_output" != "$expected_output" ]]; then
  printf 'AppleSimulatorUtils version mismatch: expected %s, got %s\n' "$expected_output" "$actual_output" >&2
  exit 1
fi
