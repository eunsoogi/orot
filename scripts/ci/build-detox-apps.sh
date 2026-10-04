#!/usr/bin/env bash
set -euo pipefail

if [[ $# -gt 1 ]]; then
  printf 'Usage: %s [all|release|openai-provider]\n' "$0" >&2
  exit 2
fi

profile="${1:-all}"
case "$profile" in
  all|release|openai-provider) ;;
  *) printf 'Unknown Detox build profile: %s\nUsage: %s [all|release|openai-provider]\n' "$profile" "$0" >&2; exit 2 ;;
esac

host_arch="$(uname -m)"
release_derived_data_path="${OROT_DETOX_RELEASE_DERIVED_DATA_PATH:-ios/build}"
openai_derived_data_path="${OROT_OPENAI_PROVIDER_DERIVED_DATA_PATH:-ios/build-openai-provider}"
case "$host_arch" in
  arm64|x86_64) ;;
  *) printf 'Unsupported iOS Simulator host architecture: %s\n' "$host_arch" >&2; exit 1 ;;
esac

node_arch="$(node -p 'process.arch')"
case "$host_arch:$node_arch" in
  arm64:arm64|x86_64:x64) ;;
  *) printf 'Node architecture %s does not match host architecture %s.\n' "$node_arch" "$host_arch" >&2; exit 1 ;;
esac

snapshot_host_resources() {
  local stage="$1"
  printf 'DETOX_BUILD_RESOURCES stage=%s utc=%s host_arch=%s node_arch=%s logical_cpus=%s physical_memory_bytes=%s\n' \
    "$stage" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$host_arch" "$node_arch" \
    "$(sysctl -n hw.logicalcpu)" "$(sysctl -n hw.memsize)"
  vm_stat | sed -n '1,8p'
}

run_timed_stage() {
  local stage="$1"
  shift
  local status=0
  snapshot_host_resources "${stage}-before"
  printf 'DETOX_BUILD_STAGE_START stage=%s utc=%s\n' "$stage" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  set +e
  /usr/bin/time -l "$@"
  status=$?
  set -e
  printf 'DETOX_BUILD_STAGE_END stage=%s utc=%s status=%s\n' "$stage" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$status"
  snapshot_host_resources "${stage}-after"
  return "$status"
}

verify_app_architecture() {
  local app_binary="$1"
  local actual_archs
  actual_archs="$(xcrun lipo -archs "$app_binary")"
  printf 'DETOX_BUILD_ARCH_VERIFY app=%s expected=%s actual=%s\n' "$app_binary" "$host_arch" "$actual_archs"
  if [[ "$actual_archs" != "$host_arch" ]]; then
    printf 'E2E app has unexpected Simulator architectures: expected %s, got %s\n' "$host_arch" "$actual_archs" >&2
    return 1
  fi
}

resolve_mobile_path() {
  local path="$1"
  if [[ "$path" == /* ]]; then
    printf '%s\n' "$path"
  else
    printf 'apps/mobile/%s\n' "$path"
  fi
}

run_timed_stage pods pnpm --filter @orot/mobile ios:pods

if [[ "$profile" == all || "$profile" == release ]]; then
  run_timed_stage release pnpm --filter @orot/mobile exec -- detox build --configuration ios.sim.release
  verify_app_architecture "$(resolve_mobile_path "$release_derived_data_path")/Build/Products/Release-iphonesimulator/Orot.app/Orot"
fi

if [[ "$profile" == all || "$profile" == openai-provider ]]; then
  run_timed_stage openai-debug pnpm --filter @orot/mobile exec -- detox build \
    --config-path ./e2e/openai-provider.detox.config.js \
    --configuration ios.sim.debug.openai-provider
  verify_app_architecture "$(resolve_mobile_path "$openai_derived_data_path")/Build/Products/Debug-iphonesimulator/Orot.app/Orot"
fi
