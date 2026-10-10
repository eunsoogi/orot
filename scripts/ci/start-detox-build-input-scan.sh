#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${RUNNER_TEMP:-}" || -z "${GITHUB_ENV:-}" ]]; then
  echo 'DETOX_DERIVEDDATA_CACHE build_input_scan_source=unavailable; cache preparation will scan synchronously.' >&2
  exit 0
fi

# Publish only by atomic rename so cache preparation never consumes a partial path list.
scan_path="$(mktemp "$RUNNER_TEMP/orot-detox-build-inputs.XXXXXX")"
scan_temporary_path="${scan_path}.tmp"
scan_error_path="${scan_path}.stderr"
rm -f "$scan_path"

# The exact post-install check overlaps Simulator boot and app-cache restore; failure keeps the synchronous cache fallback.
(
  if node scripts/ci/detox-cache-fingerprint-cli.mjs --changed-build-inputs \
    >"$scan_temporary_path" 2>"$scan_error_path"; then
    mv "$scan_temporary_path" "$scan_path"
  else
    rm -f "$scan_temporary_path"
  fi
) </dev/null >/dev/null 2>&1 &

printf 'DETOX_CACHE_BUILD_INPUTS_SCAN_PATH=%s\n' "$scan_path" >>"$GITHUB_ENV"
