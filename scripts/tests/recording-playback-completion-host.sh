#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
orot_playback_root="$(mktemp -d "${TMPDIR:-/tmp}/orot-playback-completion.XXXXXX")"
trap 'rm -rf "$orot_playback_root"' EXIT
orot_playback_source="$repository_root/apps/mobile/ios/OrotMobile/RecordingPlaybackCompletion.swift"
orot_playback_flags=(-D CURRENT_CANDIDATE)
if [[ "${1:-}" == "--baseline" ]]; then
  # Preserve the original implementation, replacing only its platform environment with the same doubles.
  git -C "$repository_root" show 19187e81138a722308503c0359cf7cd73427fd92:apps/mobile/ios/OrotMobile/RecordingPlayback.swift >"$orot_playback_root/original.swift"
  python3 - "$orot_playback_root" <<'PY'
import pathlib,sys
root=pathlib.Path(sys.argv[1]);source=(root/'original.swift').read_text()
body=source[source.index('    func stopPlayback(\n'):source.index('    func audioPlayerDidFinishPlaying')]
(root/'completion.swift').write_text('import Foundation\npublic extension RecordingModule {\n'+body+'}\n')
PY
  orot_playback_source="$orot_playback_root/completion.swift"
  orot_playback_flags=(-D BASELINE)
fi
xcrun swiftc -parse-as-library -D OROT_SPEECH_TRANSCRIPTION_SIMULATOR_TEST \
  "${orot_playback_flags[@]}" \
  "$orot_playback_source" \
  "$repository_root/apps/mobile/ios/OrotMobile/RecordingPlaybackFixtureLifetime.swift" \
  "$repository_root/scripts/tests/RecordingPlaybackCompletionHostRegression.swift" \
  -o "$orot_playback_root/regression"
"$orot_playback_root/regression"
