#!/usr/bin/env bash
set -euo pipefail

profile="${1:?Expected a Detox profile name}"

pnpm install --frozen-lockfile

if [[ "$profile" == "transcription" ]]; then
  scripts/ci/run-command.sh speech-readiness-regression artifacts/detox/speech-readiness-regression.log -- apps/mobile/e2e/transcription/run-readiness-regression.sh
fi

# Launch the source scan after workspace dependencies exist and before Simulator or cache preparation starts.
scripts/ci/start-detox-build-input-scan.sh
