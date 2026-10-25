# On-device speech transcription

> Current XCTest/XCUITest commands are in [development.md](development.md); the [requirement map](ios-validation.md) links the original scenarios to their maintained tests.

`AppleOnDeviceSpeechProvider` implements the shared `TranscriptionProvider`
contract for Korean audio. It returns transcript text with start and end times
in seconds from the beginning of the audio file. It does not stream partial
results or use ChatGPT plan usage.

## Apple speech engines

On iOS 26 and later, the native module first checks whether `SpeechTranscriber`
supports Korean on the current device. It uses `SpeechAnalyzer` with a
time-indexed `SpeechTranscriber` configuration when available. That
configuration requests source audio ranges without requesting alternative or
provisional results. If that module does not support Korean, the provider checks
`DictationTranscriber` and uses its `timeIndexedLongDictation` preset, which
Apple describes for lengthy audio and cross-referencing words to time codes.
This is the appropriate Dictation preset for consultation files that can exceed
a minute. Apple describes `shortDictation` as a configuration for about a
minute of audio, so the provider does not use it for the consultation path.
[Apple lists the time-indexed SpeechTranscriber preset and its range setting](https://developer.apple.com/documentation/speech/speechtranscriber/preset),
and [the DictationTranscriber presets](https://developer.apple.com/documentation/speech/dictationtranscriber/preset)
include both short and time-indexed long dictation configurations.

Both iOS 26 transcriber paths check supported locales and the selected module's
`AssetInventory.status(forModules:)` at runtime. A locale listed as installed
does not establish readiness for a particular configuration. Supported or
downloading assets remain available for the explicit transcription action,
which reaches the analyzer's existing installation request. An unsupported
configuration returns `unsupported_device`; installed assets with no compatible
format are unavailable to that transcriber. Availability checks do not initiate
downloads.
If Korean model assets are supported but not installed, Apple `AssetInventory`
downloads and installs the model before transcription. The speech model runs on
device; fetching model assets is a separate network operation. If the model has
no compatible audio format after asset preparation, the provider may attempt
`SFSpeechRecognizer` only when that recognizer supports on-device processing.
Permission denial or restriction stays explicit, and a missing usable local
recognizer preserves the model-unavailable error. Recognition-time errors from
the fallback are reported as recognition errors. The provider never falls back
to network recognition. Apple's
[SpeechAnalyzer session](https://developer.apple.com/videos/play/wwdc2025/277/)
explains file transcription, model selection, and conversion to a compatible
audio format.

On older OS versions, or when neither iOS 26 transcriber is available, the
native module considers `SFSpeechRecognizer` only when
`supportsOnDeviceRecognition` is true and sets
`requiresOnDeviceRecognition` on every request. If Apple cannot honor an
on-device request, this provider returns an explicit unsupported or unavailable
state; it never falls back to network recognition. [Apple documents that the
on-device request flag is honored only when the recognizer supports local
processing](https://developer.apple.com/documentation/speech/sfspeechrecognizer/supportsondevicerecognition).

The availability check does not prompt for permission. If the legacy engine
needs authorization, the prompt is deferred until the user starts a
transcription. `NSSpeechRecognitionUsageDescription` explains this use in the
system prompt. Apple's authorization article applies to `SFSpeechRecognizer`;
it notes that `SpeechAnalyzer` transcriber modules do not send voice audio to
Apple servers. [Speech recognition permission guidance](https://developer.apple.com/documentation/speech/asking-permission-to-use-speech-recognition).

## Audio handling and timestamps

The provider accepts AAC, CAF, M4A/MP4, and WAV audio. The native bridge writes
the supplied bytes to a temporary file in the protected, backup-excluded Caches
directory, checks the file attributes, converts the input to the selected
SpeechAnalyzer-compatible format when needed, and removes source and converted
audio after processing. Stale transcription files older than 24 hours are
removed the next time the provider runs. These working copies remain excluded
even though the separate permanent recording can be eligible under the
[device-backup policy](backup.md). Audio stays on the device and is not added to
the local record repository by this provider.

On the iOS 27 Simulator used for the probe, Foundation returned no
`NSFileProtectionKey` value while reporting backup exclusion. That means the
Simulator run cannot prove file-protection encryption. The test-only exception
is limited to synthetic fixtures in a Simulator build compiled with
`OROT_SPEECH_TRANSCRIPTION_SIMULATOR_TEST`; production device checks still
require the protection attribute and backup exclusion.

Each returned segment has `startSeconds`, `endSeconds`, and `text`. Newer
SpeechTranscriber results use the time range associated with the source audio;
the legacy recognizer uses its segment timestamp and duration. [Apple defines
the result range as the audio input range it applies to](https://developer.apple.com/documentation/speech/speechmoduleresult/range).

## Persisted transcript evidence

The recording screen requests transcription by saved recording UUID. The
native module resolves that UUID to the protected `.m4a` or `.caf` file inside
Application Support; the audio bytes and filesystem path do not cross into
JavaScript. On success, the app stores timestamped transcript segments in the
local record repository. It floors the start and ceils the end when converting
the engine's seconds to integer milliseconds, then checks the range against the
recording duration. Each segment keeps its recording source ID, language,
engine identifier, operating-system runtime version, and unreviewed state.
The runtime version is the iOS version string reported by `ProcessInfo`; Apple
does not expose a separate Speech model build identifier here.

Editing a segment appends a new revision with a link to the prior revision.
The original text, audio range, and engine provenance remain available in the
revision history. A correction is marked `user_reported` and `needs_review`;
the machine result remains derived evidence and is not promoted to a medical
fact. Derived records whose provenance names an earlier transcript revision
are retained and marked stale. The app does not silently rewrite or regenerate
those records. The transcript panel shows revision history, review state,
engine/runtime provenance, stale-artifact count, and the segment's audio range.
Playback uses the recording UUID and requested range through the native player,
which seeks in the local recording and stops at the range end.

## Simulator integration and UI checks

The `speech` profile calls the real `SpeechTranscriptionModule` with three short synthetic Korean AAC samples generated with the macOS Yuna voice. The expected text records the spoken input; it is not an Apple transcript. Each fixture retains encoded audio, duration and SHA-256. The profile runs on the pinned iOS 26.2 runtime described in the development guide.

A separate `SpeechAssetPreparationTests` case installs the selected Korean model assets without recognizing a fixture. `SpeechIntegrationTests` then records the actual engine, recognized text, segment ranges, input hashes and case-level metrics, and checks cancellation and failure handling. An unavailable engine, missing result or skipped case cannot satisfy the complete cohort.

`SpeechJourneyUITests` proves that actual recognition reaches a saved recording and survives app relaunch. `AutomaticTranscriptionUITests` checks the screen's stop/save flow and reopening without another recognition call. `RecordingExportUITests` preserves the sharing cancellation, temporary-file cleanup and source-preservation checks. The `core` profile separately runs `TranscriptEvidenceUITests` for review, correction history, timed playback, stale derived evidence and deletion across relaunch.

These checks use synthetic audio and isolated app data. They do not prove microphone acoustics or physical-device behavior. Build, owned-Simulator setup, execution and cleanup commands belong in [development.md](development.md); the exact case list is maintained in `scripts/ci/ios-test-inventory.mjs`.

## Historical Simulator observations

The initial iPhone 17e / iOS 27 Simulator probe at revision `a4295b9` returned `model_unavailable` for
`dictation_transcriber` (`ko_KR`, `modelInstalled=true`): Korean Dictation was
reported supported and installed, but the compatible-audio-format list was
empty. The three synthetic files were not transcribed, so CER and the focused
medication, number, and negation measures remain unmeasured. This observation
records the old availability path, which used installed locales and returned
before requesting configuration assets. It does not establish that the runtime
cannot transcribe after configuration-specific asset preparation, nor behavior
on a physical device.

The corrected configuration-status path was then run on a new dedicated
iPhone 17e / iOS 27 Simulator on 2026-10-05. Initial availability was
`available`, `dictation_transcriber`, `ko_KR`, `modelInstalled=false`.
Transcription reached the analyzer's asset request and then returned
`MODEL_UNAVAILABLE: Apple has no installed audio format for this on-device
speech model.` The probe again reported `cases=[]`. The installation path did
not throw `MODEL_INSTALL_FAILED`, but this run did not measure downloaded bytes
or independently record post-request asset status. This iOS 27 run supplies no
transcript, timestamp ranges, or accuracy observations. The separate iOS 26.2
Simulator run below did produce them.

## Accuracy method and limits

The probe reports normalized exact match and character error rate (CER). It
normalizes text to NFC, lowercases it, and removes whitespace and punctuation;
digits remain digits, so differences such as `500` versus `오백` remain in CER.
CER is Levenshtein edit distance divided by the expected normalized character
count.
Number preservation is reported separately by checking fixture-declared spoken
or numeric forms. Medication-name retention checks the fixture's medication
term. Negation retention checks an action-linked phrase such as `복용하지 않았`
or `복용 안 했`, rather than counting an unrelated syllable elsewhere in the
sentence.

These measures describe the returned characters and focused phrases in three
controlled, single-speaker synthetic clips. They do not measure performance
with real speakers, accents, background noise, overlapping speakers, longer
consultations, or clinical meaning. A matched medication name, number, or
negation phrase is not a clinical safety assessment.

| Case | Input duration | Input SHA-256 | Recognized text | Audio-relative range | CER | Medication | Number | Negation |
| --- | ---: | --- | --- | ---: | ---: | --- | --- | --- |
| Medication name | 2.584717 s | `aa4f2369c0a602b49a920942e4055e2d129a643a0bbfc5eefb5b72997271cda8` | 가상 의약품 이름은 매트 푸르 인 입니다 | 0.06–2.58475 s | 18.75% | No | — | — |
| Number | 2.229070 s | `1baae7c13b6c9f77824a73a88357953a371911c8ae884a51888d1381cc133dd3` | 복용량은 500mg 입니다 | 0–2.2290625 s | 46.15% | — | Yes | — |
| Negation | 2.226939 s | `51ad11350d6c6e96eab75399f37a3cdf3f83e3d05a015792e32dbc57282bb210` | 오늘은 약을 복용 하지 않았습니다 | 0–2.2269375 s | 0% | — | — | Yes |

## iOS 26.2 Simulator observation (2026-10-05)

A dedicated iPhone 17 Simulator (`iPhone18,3`) on iOS 26.2 (build `23C54`)
ran the Release Detox probe: one suite and one test passed. Initial availability
selected `DictationTranscriber` for `ko_KR` with `modelInstalled=false`. The
native run requested the configuration assets, called
`downloadAndInstall()`, then reported the assets installed with compatible
mono 16 kHz and 8 kHz formats. Runtime diagnostics record the
`dictation_transcriber` engine for all three fixture operations. Each operation
returned one real segment with audio-relative start and end times shown above;
the 33-microsecond overrun on the first segment is within the probe's existing
0.1-second duration tolerance. No legacy recognizer fallback or remote speech
service produced these results.

All three inputs are synthetic macOS Yuna speech. The results demonstrate the
current Simulator path and its observed transcription only; they are not a
clinical accuracy estimate. The medication name was misrecognized, while the
number/unit and negation focus checks matched. Do not replace the recognized
text with the fixture's expected input.

## Supplementary macOS observation (2026-10-05)

A standalone macOS 27.0.1 arm64 probe used the same three synthetic fixtures and
`DictationTranscriber.timeIndexedLongDictation`. Although `ko_KR` appeared in
installed locales, the module initially reported asset status `supported`.
After the authorized `assetInstallationRequest(supporting:)` call returned nil,
status was `installed`; no download request object or transferred bytes were
observed. Compatible mono Int16 PCM formats were 16 kHz and 8 kHz.

| Case | Actual Apple text | Audio-relative range | CER | Focus retained |
| --- | --- | --- | ---: | --- |
| Medication | 가상 의약품 이름은 매트 푸르 입니다 | 0.03–2.58475 s | 18.75% | No: 메트포르민 misrecognized |
| Number | 복용량은 500mg 입니다 | 0–2.2290625 s | 46.15% | Yes: 500mg |
| Negation | 오늘은 약을 복용 하지 않았습니다 | 0–2.2269375 s | 0% | Yes |

These final native results were evaluated by the existing
`accuracyEvaluation.ts`, with fixture hashes checked before evaluation. The
number CER includes the spoken-to-numeric spelling difference. The medication
error illustrates why these outputs require review. All three ranges passed
the existing 0.1-second duration tolerance. These are macOS observations only
and are kept separate from the iOS 26.2 Simulator measurements above.

The native availability routing regression can be compiled on macOS with Swift
and the macOS 26+ Speech SDK, without installing models or invoking recognition:

```sh
swiftc -parse-as-library -target arm64-apple-macosx26.0 -framework Speech \
  apps/mobile/ios/OrotMobile/SpeechTranscriptionTypes.swift \
  apps/mobile/ios/OrotMobile/SpeechTranscriptionAvailability.swift \
  apps/mobile/e2e/transcription/availabilityRegression.swift \
  -o /tmp/orot-availability-regression
/tmp/orot-availability-regression
```

It checks both engines across pending assets, unsupported configurations, and
installed assets with and without compatible formats. It also checks rejection
of unsupported request languages. These deterministic routing checks supplement
the real-device-class execution probe; they do not prove Speech service behavior.
