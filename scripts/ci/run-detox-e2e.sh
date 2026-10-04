#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 0 ]]; then
  printf 'Usage: %s\n' "$0" >&2
  exit 2
fi
if [[ -z "${DETOX_ARTIFACTS_LOCATION:-}" ]]; then
  printf 'DETOX_ARTIFACTS_LOCATION is required.\n' >&2
  exit 2
fi
if [[ -z "${OROT_DETOX_SIMULATOR_UDID:-}" || -z "${OROT_OPENAI_PROVIDER_SIMULATOR_UDID:-}" ]]; then
  printf 'A dedicated Detox Simulator UDID is required for both app configurations.\n' >&2
  exit 2
fi
if [[ "$OROT_DETOX_SIMULATOR_UDID" != "$OROT_OPENAI_PROVIDER_SIMULATOR_UDID" ]]; then
  printf 'Release and OpenAI Debug must use the same dedicated Detox Simulator.\n' >&2
  exit 2
fi

mkdir -p "$DETOX_ARTIFACTS_LOCATION/release" "$DETOX_ARTIFACTS_LOCATION/openai-provider"
release_status=0
debug_status=0

pnpm --filter @orot/mobile exec -- detox test \
  --configuration ios.sim.release \
  --artifacts-location "$DETOX_ARTIFACTS_LOCATION/release" || release_status=$?

pnpm --filter @orot/mobile exec -- detox test \
  --config-path ./e2e/openai-provider.detox.config.js \
  --configuration ios.sim.debug.openai-provider \
  --artifacts-location "$DETOX_ARTIFACTS_LOCATION/openai-provider" || debug_status=$?

if [[ "$release_status" -ne 0 || "$debug_status" -ne 0 ]]; then
  printf 'Detox suite failure: Release exit %s; OpenAI Debug exit %s.\n' "$release_status" "$debug_status" >&2
  exit 1
fi
