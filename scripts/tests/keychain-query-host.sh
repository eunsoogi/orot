#!/usr/bin/env bash
set -euo pipefail

# Validate the pinned helper against Apple's actual host frameworks. Native iOS
# storage tests remain responsible for SecItem round trips in the application.
root="$(cd "$(dirname "$0")/../.." && pwd)"
output="$(mktemp -d "${TMPDIR:-/tmp}/orot-keychain-query.XXXXXX")"
trap 'rm -rf "$output"' EXIT
xcrun clang -fobjc-arc -Werror=deprecated-declarations \
  -I "$root/apps/mobile/node_modules/react-native-keychain/ios/RNKeychainManager" \
  "$root/scripts/tests/KeychainQueryRegression.m" \
  -framework Foundation -framework LocalAuthentication -framework Security \
  -o "$output/keychain-query"
"$output/keychain-query"

# Compile the installed option mapper, then verify its diagnostic boundary with
# an intentionally adjacent SDK reference outside the compatibility exception.
python3 - "$root" "$output" <<'PY'
import pathlib
import subprocess
import sys

root, output = map(pathlib.Path, sys.argv[1:])
package = root / 'apps/mobile/node_modules/react-native-keychain'
source = (package / 'ios/RNKeychainManager/RNKeychainManager.m').read_text()
start = source.index('CFStringRef accessibleValue(')
end = source.index('\n}', start) + 2
(output / 'KeychainAccessibility.inc').write_text(source[start:end])
enum = (package / 'src/enums.ts').read_text()
assert "ALWAYS = 'AccessibleAlways'" in enum
command = ['xcrun', 'clang', '-fobjc-arc', '-Werror=deprecated-declarations',
           '-I', str(output), str(root / 'scripts/tests/KeychainAccessibilityRegression.m'),
           '-framework', 'Foundation', '-framework', 'Security',
           '-o', str(output / 'keychain-accessibility')]
subprocess.run(command, check=True)
subprocess.run([str(output / 'keychain-accessibility')], check=True)
probe = subprocess.run(command + ['-DPROBE_ADJACENT_DEPRECATION'], capture_output=True, text=True)
assert probe.returncode != 0, 'Adjacent deprecated use was unexpectedly suppressed'
assert probe.stderr.count('error:') == 1, probe.stderr
assert "'kSecAttrAccessibleAlways' is deprecated" in probe.stderr, probe.stderr
# Formatting may move the probe; keep the source identity without pinning a line number.
assert 'KeychainAccessibilityRegression.m:' in probe.stderr, probe.stderr
print('keychain-adjacent-deprecation=detected')
PY
