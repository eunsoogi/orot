#!/usr/bin/env bash
set -euo pipefail

# Validate CocoaPods first and keep the opt-in diagnostic scoped to this install command.
scripts/ci/verify-toolchain.sh --cocoapods-only
diagnostic_path="${GITHUB_WORKSPACE:-$PWD}/scripts/ci/cocoapods-null-byte-diagnostic.rb"
OROT_COCOAPODS_NULL_BYTE_DIAGNOSTIC=1 RUBYOPT="-r${diagnostic_path}" scripts/ci/run-command.sh detox-pods artifacts/detox/pods-install.log -- bash scripts/ci/build-detox-apps.sh pods
