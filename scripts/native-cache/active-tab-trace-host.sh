#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/mach"
printf '#undef TARGET_OS_SIMULATOR\n#define TARGET_OS_SIMULATOR 1\n' > "$work/TargetConditionals.h"
printf 'extern "C" unsigned long long mach_absolute_time();\n' > "$work/mach/mach_time.h"
printf 'extern "C" int *_NSGetArgc();\nextern "C" char ***_NSGetArgv();\n' > "$work/crt_externs.h"
package="$(node -p "require('path').dirname(require.resolve('@op-engineering/op-sqlite/package.json', {paths: ['./apps/mobile']}))")"
"${CXX:-c++}" -std=c++20 -Wall -Wextra -Werror -DOROT_TESTS -D__APPLE__ \
  -I "$work" -I "$package/cpp" scripts/native-cache/activeTabTrace.test.cpp -o "$work/trace"
TMPDIR="$work" "$work/trace"
rm -f "$work/orot-active-tab-01234567-89ab-cdef-0123-456789abcdef.log"
react="$(node -p "require('path').dirname(require.resolve('react-native/package.json', {paths: ['./apps/mobile']}))")"
# Compile the actual patched bridge with the opt-in guard and host shims, without
# claiming an Apple SDK or SQLCipher runtime result.
"${CXX:-c++}" -std=c++20 -DOROT_TESTS -D__APPLE__ -I "$work" \
  -ffunction-sections -fdata-sections -I "$package/cpp" -I "$react/ReactCommon/callinvoker" -I "$react/ReactCommon/jsi" \
  -c "$package/cpp/OPBridge.cpp" -o "$work/bridge.o"
strings "$work/bridge.o" > "$work/test-strings"
rg -q OROT_ACTIVE_TAB_NATIVE_STEP "$work/test-strings"
sections=(-Wl,-dead_strip)
if [[ "$(uname -s)" == Linux ]]; then sections=(-Wl,--gc-sections); fi
"${CXX:-c++}" -std=c++20 -I "$package/cpp" -I "$react/ReactCommon/callinvoker" \
  -I "$react/ReactCommon/jsi" scripts/native-cache/activeTabBridge.test.cpp "$work/bridge.o" \
  "${sections[@]}" -lsqlite3 -o "$work/driver"
if ! TMPDIR="$work" "$work/driver" 2> "$work/events"; then
  cat "$work/events" >&2
  exit 1
fi
test "$(rg -c '^OROT_ACTIVE_TAB_NATIVE_STEP ' "$work/events")" -eq 6
test "$(rg -c ' done$' "$work/events")" -eq 1
receipt="$work/orot-active-tab-01234567-89ab-cdef-0123-456789abcdef.log"
test "$(wc -l < "$receipt" | tr -d ' ')" -eq 6
tail -n 2 "$receipt" | rg -q ' terminal-row$'
tail -n 1 "$receipt" | rg -q '^6 [0-9]+ [0-9]+ terminal$'
"${CXX:-c++}" -std=c++20 -I "$work" -I "$package/cpp" \
  -I "$react/ReactCommon/callinvoker" -I "$react/ReactCommon/jsi" \
  -c "$package/cpp/OPBridge.cpp" -o "$work/production.o"
printf '#undef TARGET_OS_SIMULATOR\n#define TARGET_OS_SIMULATOR 0\n' > "$work/TargetConditionals.h"
"${CXX:-c++}" -std=c++20 -DOROT_TESTS -D__APPLE__ -I "$work" \
  -I "$package/cpp" -I "$react/ReactCommon/callinvoker" -I "$react/ReactCommon/jsi" \
  -c "$package/cpp/OPBridge.cpp" -o "$work/device.o"
strings "$work/production.o" "$work/device.o" > "$work/excluded-strings"
if rg -q OROT_ACTIVE_TAB_NATIVE_STEP "$work/excluded-strings"; then
  printf 'Unexpected observer in an excluded build boundary\n' >&2
  exit 1
fi
