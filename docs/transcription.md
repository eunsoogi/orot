# On-device speech transcription

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

Both iOS 26 transcriber paths check supported and installed locales at runtime.
If Korean model assets are supported but not installed, Apple `AssetInventory`
downloads and installs the model before transcription. The speech model runs on
device; fetching model assets is a separate network operation. If the model has
no compatible audio format on the current runtime, the provider returns an
explicit `model_unavailable` state before reporting any transcription. Apple's
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
removed the next time the provider runs. Audio stays on the device and is not
added to the local record repository by this provider.

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

## Simulator probe

The isolated Detox entry point calls the real TypeScript provider and native
`SpeechTranscriptionModule`. It bundles three short, synthetic Korean AAC
samples generated with the macOS Yuna voice. The expected text records the
spoken input; it is not an Apple transcript. The fixture includes the encoded
audio, duration, and SHA-256 for each sample.

From `apps/mobile`, set a fresh dedicated Simulator UDID and a separate
DerivedData directory, then run:

```sh
export OROT_SPEECH_TRANSCRIPTION_SIMULATOR_UDID=<dedicated-simulator-udid>
export OROT_SPEECH_TRANSCRIPTION_DERIVED_DATA_PATH=ios/build-speech-transcription
pnpm exec detox build --config-path ./e2e/transcription.detox.config.js --configuration ios.sim.release.transcription
pnpm exec detox test --config-path ./e2e/transcription.detox.config.js --configuration ios.sim.release.transcription --artifacts-location ./e2e/artifacts/transcription
```

The test grants speech recognition permission on that Simulator for the legacy
API and feeds the fixture files directly to the provider when the native module
reports availability. It records the initial native availability, engine,
installed-model state, actual recognized text, segment timestamps, input
hashes, and case-level metrics. A supported result has the
`SPEECH_TRANSCRIPTION_SIMULATOR_RESULT` log prefix. An explicit unsupported-
language, unsupported-device, unavailable-model, denied or restricted
permission, or unavailable-recognizer result uses
`SPEECH_TRANSCRIPTION_SIMULATOR_UNSUPPORTED`. A module-registration or
recognition error without an explicit unsupported state fails the probe.

The observed iPhone 17e / iOS 27 Simulator result is `model_unavailable` for
`dictation_transcriber` (`ko_KR`, `modelInstalled=true`): Korean Dictation was
reported supported and installed, but the compatible-audio-format list was
empty. The three synthetic files were not transcribed, so CER and the focused
medication, number, and negation measures remain unmeasured. This observation
describes that Simulator runtime and does not establish behavior on a physical
device.

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

| Case | Input duration | Input SHA-256 | Recognized text | CER | Medication | Number | Negation |
| --- | ---: | --- | --- | ---: | --- | --- | --- |
| Medication name | 2.584717 s | `aa4f2369c0a602b49a920942e4055e2d129a643a0bbfc5eefb5b72997271cda8` | Not measured yet | — | — | — | — |
| Number | 2.229070 s | `1baae7c13b6c9f77824a73a88357953a371911c8ae884a51888d1381cc133dd3` | Not measured yet | — | — | — | — |
| Negation | 2.226939 s | `51ad11350d6c6e96eab75399f37a3cdf3f83e3d05a015792e32dbc57282bb210` | Not measured yet | — | — | — | — |

The table is intentionally left unmeasured because the dedicated Simulator
probe returned an explicit unavailable-model state before transcription. Do not
substitute mock output or the fixture's expected text for an Apple result.
