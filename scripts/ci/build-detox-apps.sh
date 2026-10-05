#!/usr/bin/env bash
set -euo pipefail

if [[ $# -gt 2 ]]; then
  printf 'Usage: %s [all|release|openai-provider|pods] [--skip-pods]\n' "$0" >&2
  exit 2
fi

profile="${1:-all}"
skip_pods=false
if [[ "${2:-}" == "--skip-pods" ]]; then
  skip_pods=true
elif [[ $# -eq 2 ]]; then
  printf 'Unknown build option: %s\nUsage: %s [all|release|openai-provider|pods] [--skip-pods]\n' "$2" "$0" >&2
  exit 2
fi
case "$profile" in
  all | release | openai-provider | pods) ;;
  *)
    printf 'Unknown Detox build profile: %s\nUsage: %s [all|release|openai-provider|pods] [--skip-pods]\n' "$profile" "$0" >&2
    exit 2
    ;;
esac
if [[ "$profile" == pods && ("$skip_pods" == true || $# -ne 1) ]]; then
  printf 'The pods profile does not accept build options.\n' >&2
  exit 2
fi

host_arch="$(uname -m)"
release_derived_data_path="${OROT_DETOX_RELEASE_DERIVED_DATA_PATH:-ios/build-detox-release}"
openai_derived_data_path="${OROT_OPENAI_PROVIDER_DERIVED_DATA_PATH:-ios/build-detox-openai-provider}"
case "$host_arch" in
  arm64 | x86_64) ;;
  *)
    printf 'Unsupported iOS Simulator host architecture: %s\n' "$host_arch" >&2
    exit 1
    ;;
esac

node_arch="$(node -p 'process.arch')"
case "$host_arch:$node_arch" in
  arm64:arm64 | x86_64:x64) ;;
  *)
    printf 'Node architecture %s does not match host architecture %s.\n' "$node_arch" "$host_arch" >&2
    exit 1
    ;;
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

if [[ "$profile" == pods ]]; then
  run_timed_stage pods pnpm --filter @orot/mobile ios:pods
  exit 0
fi

if [[ "$skip_pods" != true ]]; then
  run_timed_stage pods pnpm --filter @orot/mobile ios:pods
fi

if [[ "${GITHUB_ACTIONS:-}" == true ]]; then
  # Preserve Pods' effective project and privacy inputs before the native build consumes them.
  case "$profile" in
    release | openai-provider)
      node scripts/ci/detox-derived-data-cache.mjs verify-build-inputs "$profile"
      ;;
    *)
      printf 'GitHub Actions Detox builds require one prepared cache profile, got %s.\n' "$profile" >&2
      exit 1
      ;;
  esac
fi

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
