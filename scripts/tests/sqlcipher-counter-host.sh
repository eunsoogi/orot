#!/usr/bin/env bash
set -euo pipefail

# Run against the installed, patched amalgamation, independently of an iOS app.
# Native iOS storage regressions remain required for the mobile integration boundary.
root="$(cd "$(dirname "$0")/../.." && pwd)"
output="$(mktemp -d "${TMPDIR:-/tmp}/orot-sqlcipher-counter.XXXXXX")"
trap 'rm -rf "$output"' EXIT
openssl_cflags=()
openssl_libs=()
read -r -a openssl_cflags <<<"$(pkg-config --cflags openssl)"
read -r -a openssl_libs <<<"$(pkg-config --libs openssl)"
platform_libs=()
if [[ "$(uname -s)" == Darwin ]]; then
  platform_libs=(-framework Security)
fi
sqlcipher_dir="$root/apps/mobile/node_modules/@op-engineering/op-sqlite/cpp/sqlcipher"
# The documented size override can exceed INT_MAX, so the wipe must receive it intact.
if ! grep -Eq 'xoshiro_randomness\(private_heap,[[:space:]]*private_heap_sz\)' "$sqlcipher_dir/sqlite3.c" ||
  grep -Eq 'xoshiro_randomness\(private_heap,[[:space:]]*\(int\)[[:space:]]*private_heap_sz\)' "$sqlcipher_dir/sqlite3.c"; then
  echo "SQLCipher private heap wiping must pass its full configured size" >&2
  exit 1
fi
for suite in Counter Range Feature; do
  cc -O1 -DSQLITE_HAS_CODEC -DSQLCIPHER_CRYPTO_OPENSSL -DSQLITE_TEMP_STORE=3 \
    -DSQLITE_ENABLE_FTS5 -DSQLITE_EXTRA_INIT=sqlcipher_extra_init \
    -DSQLITE_EXTRA_SHUTDOWN=sqlcipher_extra_shutdown \
    -I "$sqlcipher_dir" \
    "${openssl_cflags[@]}" "$root/scripts/tests/SQLCipher${suite}Regression.c" \
    "${openssl_libs[@]}" "${platform_libs[@]}" -o "$output/$suite-regression"
  "$output/$suite-regression" "$output"
done
