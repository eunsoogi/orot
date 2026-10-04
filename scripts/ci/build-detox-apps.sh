#!/usr/bin/env bash
set -euo pipefail

pnpm --filter @orot/mobile ios:pods
pnpm --filter @orot/mobile exec -- detox build --configuration ios.sim.release
pnpm --filter @orot/mobile exec -- detox build \
  --config-path ./e2e/openai-provider.detox.config.js \
  --configuration ios.sim.debug.openai-provider
