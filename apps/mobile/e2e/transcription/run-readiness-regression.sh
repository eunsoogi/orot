#!/usr/bin/env bash
set -euo pipefail

temporary_directory="$(mktemp -d "${TMPDIR:-/tmp}/orot-speech-readiness.XXXXXX")"
trap 'rm -rf "$temporary_directory"' EXIT

# Use the macOS 26 Speech SDK; injected closures avoid Simulator startup and audio access.
swiftc \
  -sdk "$(xcrun --sdk macosx --show-sdk-path)" \
  -target "$(uname -m)-apple-macosx26.0" \
  -parse-as-library \
  -o "$temporary_directory/readiness-regression" \
  apps/mobile/ios/OrotMobile/SpeechTranscriptionTypes.swift \
  apps/mobile/ios/OrotMobile/SpeechTranscriptionAvailability.swift \
  apps/mobile/ios/OrotMobile/SpeechTranscriptionAnalyzer.swift \
  apps/mobile/ios/OrotMobile/SpeechTranscriptionLegacyRecognizer.swift \
  apps/mobile/e2e/transcription/analyzerReadinessRegression.swift \
  apps/mobile/e2e/transcription/deadlineCancellationRegression.swift

"$temporary_directory/readiness-regression"
