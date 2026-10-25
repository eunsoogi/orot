#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
orot_test_root="$(mktemp -d "${TMPDIR:-/tmp}/orot-recording-export-host.XXXXXX")"
trap 'chmod -R u+w "$orot_test_root"; rm -rf "$orot_test_root"' EXIT

# An isolated Foundation temporary root prevents this test from touching app or user export data.
swiftc -parse-as-library \
  "$repository_root/apps/mobile/ios/OrotMobile/RecordingExportFiles.swift" \
  "$repository_root/scripts/tests/RecordingExportFilesHostRegression.swift" \
  -o "$orot_test_root/RecordingExportFilesHostRegression"

env TMPDIR="$orot_test_root" "$orot_test_root/RecordingExportFilesHostRegression"
