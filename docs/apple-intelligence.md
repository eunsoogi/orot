# Apple Intelligence provider

Orot exposes Apple's on-device Foundation Models through the existing
`@orot/model-runtime` provider contract. The adapter uses the system model only;
it does not send prompts to a server or fall back to another provider. Apple
describes `SystemLanguageModel.default` as an on-device model and requires apps
to check its current availability before requesting generation. See [Apple's
Foundation Models documentation](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel).

## Availability

`getAvailability()` reads `SystemLanguageModel.default.availability` and checks
whether the system model supports `ko-KR`. The provider returns one of these
states:

| State | Meaning |
| --- | --- |
| `available` | The model is ready and Korean is supported. |
| `disabled` | Apple Intelligence is not enabled in system settings. |
| `modelNotReady` | The model is not ready on this device. Apple says the model may be downloading or unavailable for another system reason. |
| `unsupportedDevice` | The operating system or device cannot use the model. |
| `unsupportedLanguage` | The model is available but does not support Korean. |

These states come from Apple's availability and locale APIs. Apple currently
documents `appleIntelligenceNotEnabled`, `deviceNotEligible`, and
`modelNotReady` as unavailable reasons. Apple's [`modelNotReady` documentation](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel/availability-swift.enum/unavailablereason/modelnotready)
says models download automatically based on conditions such as network status,
battery level, and system load. The [Apple Intelligence setup guide](https://support.apple.com/en-us/121115)
explains that downloads begin after Apple Intelligence is turned on. The app
must display the returned state instead of guessing from the device model or
silently switching providers.

## Capabilities and boundaries

- Text input and text generation are supported. Image and audio input return an
  explicit unsupported-input error.
- Guided structured output supports strings, integers, numbers, booleans,
  string enums, arrays, objects, and `anyOf` unions. Unsupported JSON Schema
  keywords or constraints are rejected before inference.
- Tool requests are normalized into allowlisted tool names and JSON arguments.
  The provider returns tool calls; it never executes them or performs their
  side effects.
- Streaming converts cumulative text snapshots into append-only deltas. If a
  snapshot rewrites prior text, the stream fails. Structured and tool requests
  currently reject streaming explicitly.
- The provider adds Korean visit-question guidance, preserves supplied source
  identifiers in the request and normalized output, and does not provide
  diagnosis or medication-change instructions. Prompt guidance is not a clinical
  safety guarantee; downstream validation and user review still apply.
- Cancellation sends `Task.cancel()` to the bridge task and prevents late
  results from reaching the caller. This does not prove that Foundation Models
  stopped its underlying inference.

`appleAvailabilityMessage()` and `appleGenerationFailureMessage()` return the
Korean strings used by the mobile app when it presents these states.

## Verification

The unit suite uses a deterministic fake native boundary for provider
capabilities, structured responses, input errors, unavailable states, streaming,
and cancellation. It does not claim Apple framework inference occurred.

The separate Detox probe uses only synthetic visit text and the real native
module. Create one dedicated iOS Simulator, then set these values to that
device's exact identifiers and to an evidence directory outside the checkout:

```sh
export OROT_APPLE_FOUNDATION_MODELS_SIMULATOR_UDID="<dedicated simulator UDID>"
export OROT_APPLE_FOUNDATION_MODELS_DERIVED_DATA_PATH="<new dedicated build path>"
export OROT_APPLE_FOUNDATION_MODELS_EVIDENCE_DIR="<evidence directory>"
```

Build and run the probe with:

```sh
pnpm --filter @orot/mobile e2e:build:ios:apple-foundation-models
pnpm --filter @orot/mobile e2e:test:ios:apple-foundation-models
```

The build and Detox runner both target the explicit simulator UDID, avoiding an
implicit default device. The probe always reports the live availability state. It attempts
structured generation, verifies the synthetic source ID, and requests native
cancellation only when the model reports `available`. If the model is
unavailable, generation, source-ID verification, and cancellation are recorded
as `not-run`. If the request finishes before cancellation, the probe reports
`completed-before-cancel`. Its `inferenceStop=unverified` field makes clear that
the framework's underlying inference termination was not observed.

On 2026-10-04, the dedicated iPhone 18 Pro Simulator on iOS 27.0 first reported
`modelNotReady`. A later run on the same Simulator reported `available` without
manual changes to Apple Intelligence settings or an Apple Account sign-in. The
real Detox probe then completed structured generation, verified the synthetic
source ID, and observed the bridge cancellation path:

```text
availability=available; generation=passed; sourceIdPreserved=passed; cancellation=cancelled; inferenceStop=unverified
```

The successful run used synthetic visit text. `inferenceStop=unverified` is
intentional: cancellation rejected or suppressed the bridge result, but the
test cannot establish that Foundation Models stopped its underlying inference.
The earlier `modelNotReady` result is retained as an observed unavailable state;
the later result shows that readiness can change on the same Simulator without
an app-side provider fallback.
