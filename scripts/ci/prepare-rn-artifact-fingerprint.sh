#!/usr/bin/env bash
set -euo pipefail

# Freeze GitHub's pre-restore lockfile hashes so a later install cannot change the recorded cache identity.
if [[ -z "${PNPM_LOCKFILE_HASH:-}" || -z "${PODFILE_LOCK_HASH:-}" ]]; then
  echo "React Native artifact cache requires both lockfile hashes." >&2
  exit 1
fi

if [[ -z "${GITHUB_OUTPUT:-}" ]]; then
  echo "GitHub Actions output path is unavailable." >&2
  exit 1
fi

printf 'fingerprint=%s-%s\n' "$PNPM_LOCKFILE_HASH" "$PODFILE_LOCK_HASH" >>"$GITHUB_OUTPUT"
