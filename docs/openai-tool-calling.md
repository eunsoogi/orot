# ChatGPT plan local tool calling

The ChatGPT plan provider accepts Orot function-tool definitions and returns normalized `tool_call` stream events. Tool implementations stay in the application; the provider only translates their names, JSON schemas, arguments, call IDs, and results to the Responses request format.

## Request and result flow

1. Orot passes function definitions in `LanguageModelRequest.tools`.
2. The provider maps each definition to a Responses `function` tool with `strict: false`.
3. The native Responses client normalizes streamed function arguments into Orot `ToolCall` values. Invalid or non-object JSON arguments fail as a malformed provider response.
4. The application runs the named local function and returns its JSON result as a tool-role message with the same call ID.
5. The provider sends a `function_call_output` item and the preceding Responses output items, then returns the model's final completion.

The adapter sets `store: false` and asks Responses to include encrypted reasoning output. It keeps each response's reasoning, message, and function-call output items in memory on the provider instance and replays them unchanged across successive local tool results. After a response completes without another tool call, it removes the cached continuation items for the call IDs consumed by that request. If the provider instance is recreated before the tool loop finishes, encrypted reasoning items are unavailable; the adapter can reconstruct function-call items from normalized history, but cannot restore the original reasoning items.

Only local function tools are supported. Hosted tools such as web search are rejected before the native request starts. A hosted tool output returned by the route is also rejected explicitly.

Cancellation, interrupted streams, and response failures keep the existing provider error paths. A tool-call event may be delivered before a later stream failure, and the failure remains the terminal result.

## Verification boundary

Automated tests use synthetic schemas, tool calls, results, and continuation items. The dedicated iOS Simulator probe uses a synthetic keychain account and an in-process HTTP fixture for a full tool-result round trip. It does not verify a real ChatGPT account or live service behavior.
