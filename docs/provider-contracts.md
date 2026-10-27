# Language model provider contracts

> Current XCTest/XCUITest commands are in [development.md](development.md); the [requirement map](ios-validation.md) links the original scenarios to their maintained tests.

`@orot/model-runtime` defines one normalized `LanguageModelProvider` interface
for the in-memory fake, Apple Foundation Models, and the ChatGPT plan adapter.
The shared conformance suite is in
[`packages/model-runtime/__tests__/providerConformance.ts`](../packages/model-runtime/__tests__/providerConformance.ts)
and uses only synthetic visit text and source IDs.

## Normalized behavior

| Behavior | In-memory fake | Apple Foundation Models | ChatGPT plan |
| --- | --- | --- | --- |
| Input | Text by default | Text only; image and audio input return `unsupported_input` | Text only; unsupported input is rejected before the native request |
| Completion | `ProviderResult<LanguageModelResponse>` | Same normalized result after checking model availability | Same normalized result collected from the completed stream |
| Streaming | Text deltas and terminal response | Cumulative native snapshots become append-only text deltas; a rewrite is an error | Responses events become normalized deltas and a terminal response |
| Structured output | Only when enabled in fake capabilities | Supported through guided generation and normalized JSON output | Not supported; returns `unsupported_capability` before starting a request |
| Tool calls | Only when enabled in fake capabilities | Returns normalized calls; the provider does not execute them | Supports local function tools; hosted tools are explicitly rejected |
| Availability and authorization | Configured deterministic result | Preserves explicit Apple availability states as `provider_unavailable`; `modelNotReady` is retryable | Preserves authorization, usage-limit, and service-availability errors as distinct provider errors |
| Fallback | None | Does not switch to another provider | Does not switch to API-key billing or another endpoint |

`LanguageModelCapabilities` is the contract consumers use before selecting an
operation. A `false` capability requires an explicit `unsupported_capability`
failure. Invalid input is rejected before native work. Providers return errors
as `{ ok: false, error }`; they do not silently change providers, endpoints, or
billing paths.

For ChatGPT, OAuth failures map to `authentication_required`, plan usage limits
to `rate_limited`, and transport/service failures to retryable
`provider_unavailable`. Apple reports an unavailable model without attempting
generation; only `modelNotReady` is marked retryable. These error categories
describe the adapter response and do not promise that retrying will succeed.

Streaming consumers may close an active iterator. The adapter then requests
cancellation of its native work. Apple bridge cancellation does not prove that
Foundation Models stopped underlying inference. ChatGPT Simulator cancellation
uses a synthetic account and intercepted HTTP responses, so it does not prove a
live service stopped processing a request.

## Visit-question workflow boundaries

The app's visit-question route enters `runVisitQuestionWorkflow`, which invokes
the shared `runMultiAgentWorkflow`. Model calls use the LangChain chat-model
adapter from `createProductionChatModel` and `invokeProductionRequest`. The
adapter converts the provider-neutral messages and tool calls at the native
provider boundary; the graph remains responsible for consent, budgets, allowed
evidence, citation validation, and result policy. Keep these boundaries:

1. Put only the intended visit evidence in the request and retain its existing
   source identifiers. Do not treat model-generated text as a source record.
2. Validate the normalized success result against the requested output schema.
   For each returned source identifier, verify that it belongs to the supplied
   evidence before presenting the question.
3. Require a patient-directed question grounded in the supplied visit evidence.
   The question may help the patient ask their clinician what to discuss or
   check; it must not turn into a diagnosis or a medication-change instruction.
4. Preserve normalized provider failures, including unavailable and unsupported
   states. Do not retry by silently selecting a different provider or payment
   path.
5. Treat a normalized tool call as a request. Only the application graph may
   execute an explicitly allowed local function, and its result must return
   with the same tool-call ID. A provider does not perform a tool's side effect.

These are workflow and product requirements, not guarantees made by a language
model adapter. The package graph test verifies direct LangGraph composition
with the standard chat-model interface; app task and citation tests establish
their own validation behavior.

## What each verification surface proves

The shared Jest suite runs against the fake provider and the Apple and ChatGPT
TypeScript adapters with deterministic native-boundary fixtures. It checks
capabilities, normalized completion, streaming, structured output and tools,
unsupported input/capabilities, mapped availability or authorization failures,
and stream-consumer cancellation. It proves adapter conformance to those
fixtures; it does not prove that Apple or ChatGPT generated a result.

The `provider-data` integration profile invokes the Apple bridge with deterministic model-call responses compiled only into test Simulator products. It verifies availability mapping, structured generation, source identifiers, streaming, cancellation and workflow behavior, and reports `modelExecution=mock` and `actualModel=not-run`. Production keeps the real SDK. The separately recorded real-model run in [apple-intelligence.md](apple-intelligence.md) does not establish current CI inference or underlying inference termination.

`ProviderIntegrationTests` exercises the ChatGPT provider and local-tool paths with a separate synthetic Keychain account and intercepted HTTP routes. It covers model discovery, a completed stream, a plan usage error, consumer cancellation, local tool-call normalization and a local tool-result round trip. Its `realAccount=unverified` report does not prove real OAuth account access or remote inference. Keep any live-account result tied to its own device, environment, request and revision.

Use the `provider-data` profile and exact integration selection described in [development.md](development.md). The provider behavior is documented in [chatgpt-streaming-inference.md](chatgpt-streaming-inference.md) and [openai-tool-calling.md](openai-tool-calling.md).
