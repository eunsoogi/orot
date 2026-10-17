# Apple Intelligence provider

> Current XCTest/XCUITest commands are in [development.md](development.md); the [requirement map](ios-validation.md) links the original scenarios to their maintained tests.

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

The maintained Simulator integration suite mocks only the Foundation Models call boundary. It exercises the shipping bridge, structured-response codec, streaming, cancellation and application workflows, and records `modelExecution=mock` and `actualModel=not-run`. Production builds keep the real SDK and exclude the mock control endpoint. See [development.md](development.md) for the current commands and product checks.

The unit suite uses a deterministic fake native boundary for provider
capabilities, structured responses, input errors, unavailable states, streaming,
and cancellation. It does not claim Apple framework inference occurred.

The `provider-data` profile runs `AppleModelIntegrationTests` and `AppleWorkflowIntegrationTests` with the test-only model boundary. They check fixed raw SDK responses, stream completion and rewriting, cancellation, failures, Calendar classification and cited question generation. They do not require a host Apple Intelligence model or establish real inference quality.

## Historical real-model observation

The following result belongs to the original 2026-10-04 Simulator run and is separate from the maintained mock-based CI checks.

On 2026-10-04, the dedicated iPhone 18 Pro Max Simulator on iOS 27.0 (`Orot Apple
Models 62 Retest`, UDID `6CA4652D-1842-4DA7-90DD-E7041F6C6A5E`) first reported
`modelNotReady`. A later run on that device reported `available` without manual
changes to Apple Intelligence settings or an Apple Account sign-in. The latest
fresh DerivedData build succeeded. The Detox probe sent this synthetic request
through the normalized provider graph:

```text
실습용 기록 synthetic-source-42: 정기 진료에서 최근 수면 변화에 관해 이야기하고 싶습니다. 다음 진료에서 의료진에게 직접 할 한국어 질문 한 가지를 제안해 주세요. 질문은 환자가 의료진에게 하는 질문이어야 합니다. 환자에게 감정을 되묻지 말고, 이 수면 변화와 관련해 진료에서 무엇을 확인하거나 이야기하면 좋을지 물어보세요.
```

Foundation Models returned this actual structured question, preserved the
synthetic source ID, and the bridge cancellation path rejected the pending
request:

```text
availability=available; generation=passed; sourceIdPreserved=passed; cancellation=cancelled; inferenceStop=unverified
선생님, 최근 수면 변화와 관련해 진료에서 무엇을 확인하거나 이야기하면 좋을까요?
```

The independent semantic sample review confirmed that the question naturally
addresses the clinician from the patient's perspective and stays grounded in
the reported change. The test rejects unsafe diagnosis and medication-change
instructions, but does not hardcode an expected sentence. That recorded run's
actual input, output, summary, and screenshot are retained outside the checkout
in `/tmp/orot-issue-62-apple-foundation-models-20261004-r9/detox/`.
`inferenceStop=unverified` is intentional: cancellation rejected the bridge
promise, but the test cannot establish that Foundation Models stopped its
underlying inference. The earlier `modelNotReady` readback is retained as an
observed unavailable state; the later readback shows that readiness changed on
the same Simulator without an app-side provider fallback.
