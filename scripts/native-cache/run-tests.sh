#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
package="$(node -p "require('path').dirname(require.resolve('@op-engineering/op-sqlite/package.json', {paths: ['./apps/mobile']}))")"
react="$(node -p "require('path').dirname(require.resolve('react-native/package.json', {paths: ['./apps/mobile']}))")"
# The installed vendor candidate is the only implementation under test. Query data
# is static generated source, never a saved user database or runtime bindings.
node - "$package" "$work" <<'JS'
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(process.argv[2], 'cpp/OrotPeriodQueries.hpp'), 'utf8');
const values = source.split('\n').filter(line => line.startsWith('"SELECT id FROM ('));
if (values.length !== 16) throw new Error('Expected exactly sixteen installed native SQL templates');
fs.writeFileSync(path.join(process.argv[3], 'PeriodRemovalAllowlist.hpp'),
  '#pragma once\n#include <string>\n#include <unordered_set>\n' +
  'inline const std::unordered_set<std::string> periodRemovalAllowlist = {\n' + values.join('\n') + '\n};\n');
JS
includes=(-I "$package/cpp" -I "$work" -I "$react/ReactCommon/callinvoker" -I "$react/ReactCommon/jsi")
flags=(-std=c++20 -Wall -Wextra -Werror)
link=(-lsqlite3)
if [[ "$(uname -s)" == Linux ]]; then link=(-l:libsqlite3.so.0); fi
for suite in Safety Failure Allocation; do
  "${CXX:-c++}" "${flags[@]}" "${includes[@]}" "scripts/native-cache/cache${suite}.test.cpp" "${link[@]}" -o "$work/$suite"
  "$work/$suite"
done
# Upstream bridge warnings are not new candidate code; compile unchanged source separately.
"${CXX:-c++}" -std=c++20 -ffunction-sections -fdata-sections "${includes[@]}" -c "$package/cpp/OPBridge.cpp" -o "$work/bridge.o"
"${CXX:-c++}" "${flags[@]}" -ffunction-sections -fdata-sections "${includes[@]}" -c "$package/cpp/OrotCachedExecute.cpp" -o "$work/cache.o"
sections=("-Wl,--gc-sections")
if [[ "$(uname -s)" == Darwin ]]; then sections=("-Wl,-dead_strip"); fi
"${CXX:-c++}" "${flags[@]}" "${includes[@]}" scripts/native-cache/cacheDriver.test.cpp "$work/bridge.o" "$work/cache.o" "${link[@]}" "${sections[@]}" -o "$work/driver"
"$work/driver"
printf 'Native cache host suites: 4 passed (system SQLite, not SQLCipher or native owner lifecycle)\n'
