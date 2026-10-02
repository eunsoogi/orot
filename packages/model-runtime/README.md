# @orot/model-runtime

This package defines provider-neutral contracts for language models, transcription,
embeddings, credentials, and telemetry. It has no provider SDK or runtime package
dependencies. Provider adapters belong in follow-up work and must translate SDK
requests, responses, and errors at their boundary.

## Contracts

- `LanguageModelProvider` describes normalized text, image, and audio requests,
  optional streaming, tool calls, structured output, and finish reasons.
- `TranscriptionProvider` and `EmbeddingProvider` return typed provider results
  without vendor-specific payloads.
- `CredentialProvider` returns generic API-key or bearer credentials. Callers
  must not expose the secret to model input or telemetry.
- `ProviderRegistry` stores language-model, transcription, and embedding
  providers by kind and id. `InMemoryProviderRegistry` rejects duplicate ids
  within one kind and validates advertised streaming methods.
- `TelemetrySink` receives only provider id, operation, outcome, duration, and
  normalized error code. Prompts, media, tool arguments, responses, and secrets
  are not part of its event contract.

Provider operations use `ProviderResult<T>` for either a normalized value or a
`ProviderError`. Adapter code should map vendor errors to the shared error
codes and safe messages; raw SDK objects must not cross this package boundary.

## Deterministic test provider

`InMemoryFakeLanguageModelProvider` returns a stable response for a request,
supports configurable normalized results and errors, and can stream normalized
events. Its default capabilities support text input, tool calls, and streaming;
structured output is opt-in. It performs no network access and must not be used
as a production provider.

The package is checked through the root `lint`, `typecheck`, and `test:unit`
commands. Its Jest config and scripts reuse the mobile workspace's installed
toolchain so no separate test dependencies are added.
