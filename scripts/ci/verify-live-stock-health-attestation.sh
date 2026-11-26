#!/bin/sh
set -eu

# Xcode's React Native environment helper supplies the same configured Node.
root=$(CDPATH='' cd "$(dirname "$0")/../.." && pwd)
exec "$NODE_BINARY" "$root/scripts/ci/live-stock-health-attestation.mjs" --check
