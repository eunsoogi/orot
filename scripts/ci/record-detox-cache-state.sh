#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 1 ]]; then
  printf 'Usage: %s <output-path>\n' "$0" >&2
  exit 2
fi

output_path="$1"
mkdir -p "$(dirname "$output_path")"

# Keep cache decisions and their toolchain provenance together in the uploaded CI artifact.
{
  printf 'profile=%s\n' "${DETOX_PROFILE}"
  printf 'detox_framework_cache_hit=%s\n' "${DETOX_FRAMEWORK_CACHE_HIT:-false}"
  printf 'react_native_artifacts_cache_hit=%s\n' "${RN_ARTIFACT_CACHE_HIT:-false}"
  printf 'cocoapods_intermediates_cache_hit=%s\n' "${COCOAPODS_CACHE_HIT:-false}"
  printf 'derived_data_cache_hit=%s\n' "${PROFILE_DERIVED_DATA_CACHE_HIT:-false}"
  printf 'derived_data_cache_classification=%s\n' "${DERIVED_DATA_CACHE_CLASSIFICATION}"
  printf 'app_reusable=%s\n' "${APP_REUSABLE}"
  printf 'app_reuse_reason=%s\n' "${APP_REUSE_REASON}"
  printf 'privacy_manifest_input_sha256=%s\n' "${PRIVACY_MANIFEST_INPUT_SHA256}"
  printf 'derived_data_cache_diagnostic=%s\n' "${DERIVED_DATA_CACHE_DIAGNOSTIC}"
  printf 'build_input_fingerprint=%s\n' "${BUILD_INPUT_FINGERPRINT}"
  printf 'react_native_artifact_fingerprint=%s\n' "${RN_ARTIFACT_FINGERPRINT}"
  printf 'native_dependency_fingerprint=%s\n' "${NATIVE_DEPENDENCY_FINGERPRINT}"
  printf 'xcodebuild_fingerprint=%s\n' "${XCODEBUILD_FINGERPRINT}"
  printf 'xcode=%s ios_simulator_sdk=%s ios_simulator_runtime=%s ios_simulator_device_type=%s\n' "${EXPECTED_XCODE_VERSION}" "${EXPECTED_IOS_SIMULATOR_SDK}" "${EXPECTED_IOS_SIMULATOR_RUNTIME_NAME}" "${EXPECTED_DETOX_SIMULATOR_DEVICE_TYPE_ID}"
  printf 'macos=%s\n' "${MACOS_VERSION}"
  printf 'node=%s\n' "${NODE_VERSION}"
  printf 'pnpm=%s\n' "${PNPM_VERSION}"
  printf 'expected_ruby=%s\n' "${RUBY_VERSION}"
  printf 'expected_cocoapods=%s\n' "${COCOAPODS_VERSION}"
  printf 'architecture=%s\n' "$(uname -m)"
} >"$output_path"
