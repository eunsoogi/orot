# ChatGPT plan models and streaming

The `@orot/provider-openai` workspace package adapts the saved ChatGPT account to Orot's `LanguageModelProvider` contract. Swift owns OAuth credentials, model discovery, Responses transport, and server-sent event decoding. TypeScript maps requests and results to the provider-neutral runtime. The React Native bridge passes the issued client ID and stream packets; it never serializes the stored account or its tokens.

## Model catalog

`ChatGPTOAuthClient.listModels(forIssuedClientID:)` requests `GET https://api.openai.com/v1/models` using the selected account's refreshed OAuth access token. It keeps models with `visibility: "list"`, preserves server order, shows `display_name`, and uses `slug` as the model sent to inference. The TypeScript adapter adds an account-scoped provider ID so models from different signed-in accounts remain distinct.

Refresh the catalog after account changes. A missing direct-plan scope, account mismatch, expired credentials, or HTTP failure is returned as a provider error with available status, code, and request-ID diagnostics.

## Responses requests

Inference uses the public `POST https://api.openai.com/v1/responses` endpoint with the selected account's OAuth bearer token. Every request sets `store: false` and `stream: true`. System messages become the Responses `instructions` field; user and assistant messages become `input` items.

The first adapter supports text messages only. It rejects tool calls/results, structured output, temperature, output-token overrides, and non-text input before starting a request. It does not switch to an API key, API billing, or ChatGPT `backend-api` endpoint when plan access fails.

## Stream and errors

The byte transport yields at SSE line endings and caps partial lines at 4 KiB, so small deltas reach the consumer while the response remains open. The decoder handles CRLF frames, fragmented UTF-8, and multiline data fields. Text deltas are normalized to `text_delta`; a `completed` result is emitted only after `response.completed` and only when its final text matches the accumulated deltas.

`response.incomplete`, `response.failed`, explicit error events, malformed data, HTTP errors, and a stream ending without `response.completed` become failures. Usage limits, unavailable usage, authentication, and unsupported capabilities keep their distinct provider error categories. Consumer cancellation closes the native request and its stream.

## Simulator verification

The Debug-only iOS Simulator fixture uses a separate Keychain service, a synthetic account/token, and a URL protocol that intercepts the model and Responses routes. It verifies visible-model filtering, completed streaming, a usage-limit failure after a delta, and consumer cancellation. It does not sign in or contact a real ChatGPT account; real-account behavior remains unverified by this fixture.

Run the package and focused Simulator checks from the repository root:

```sh
swift test --package-path packages/provider-openai
pnpm --filter @orot/provider-openai lint
pnpm --filter @orot/provider-openai typecheck
pnpm --filter @orot/provider-openai test:unit

DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
OROT_OPENAI_PROVIDER_SIMULATOR_UDID=<simulator-udid> \
pnpm --filter @orot/mobile e2e:build:ios:openai-provider

DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
OROT_OPENAI_PROVIDER_SIMULATOR_UDID=<simulator-udid> \
pnpm --filter @orot/mobile e2e:test:ios:openai-provider
```

The Detox configuration embeds its dedicated Debug entry point and accepts an explicit Simulator UDID. The test report states `realAccount=unverified` to keep synthetic and real-account evidence separate.

## OpenAI references

- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Errors and recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)
- [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
