'use strict';

const { providerFailure, providerSuccess } = require('@orot/model-runtime');
const { createTokenUsageCollector } = require('./token-usage.cjs');

const CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mapContent(content) {
  if (typeof content === 'string') return { ok: true, content };
  if (!Array.isArray(content) || content.some((part) => part?.type !== 'text')) {
    return { ok: false };
  }
  return { ok: true, content: content.map((part) => part.text).join('') };
}

function mapMessages(messages) {
  const mapped = [];
  for (const message of messages) {
    if (message.role === 'tool') {
      mapped.push({
        role: 'tool',
        tool_call_id: message.toolCallId,
        content:
          typeof message.result === 'string' ? message.result : JSON.stringify(message.result),
      });
      continue;
    }

    const content = mapContent(message.content);
    if (!content.ok) return null;
    if (message.role !== 'assistant') {
      mapped.push({ role: message.role, content: content.content });
      continue;
    }
    mapped.push({
      role: 'assistant',
      content: content.content,
      ...(message.toolCalls?.length
        ? {
            tool_calls: message.toolCalls.map((toolCall) => ({
              id: toolCall.id,
              type: 'function',
              function: { name: toolCall.name, arguments: JSON.stringify(toolCall.arguments) },
            })),
          }
        : {}),
    });
  }
  return mapped;
}

function mapRequest(model, request) {
  const messages = mapMessages(request.messages);
  if (!messages) return null;
  if (request.responseFormat?.schema) {
    // JSON mode validates syntax only; include the graph schema in context while local checks stay authoritative.
    const instruction = `Return a JSON object matching this JSON Schema:\n${JSON.stringify(request.responseFormat.schema)}`;
    const systemMessage = messages.find((message) => message.role === 'system');
    if (systemMessage) systemMessage.content = `${systemMessage.content}\n\n${instruction}`;
    else messages.unshift({ role: 'system', content: instruction });
  }
  return {
    model,
    messages,
    // Leave strict mode unset so Chat Completions accepts the runtime's JSON Schema dialect.
    ...(request.tools?.length
      ? {
          tools: request.tools.map((tool) => ({
            type: 'function',
            function: {
              name: tool.name,
              ...(tool.description ? { description: tool.description } : {}),
              parameters: tool.inputSchema,
            },
          })),
        }
      : {}),
    // #30 supplies a root oneOf schema, so JSON mode leaves schema enforcement to its local validator.
    ...(request.responseFormat ? { response_format: { type: 'json_object' } } : {}),
    ...(request.maxOutputTokens !== undefined
      ? { max_completion_tokens: request.maxOutputTokens }
      : {}),
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
  };
}

function providerError(code, message, retryable) {
  return providerFailure({ code, message, retryable });
}

function mapResponse(payload, request) {
  const choice = payload?.choices?.[0];
  const message = choice?.message;
  if (!isRecord(message)) {
    return providerError('provider_unavailable', 'OpenAI API returned an invalid response.', false);
  }

  let toolCalls;
  try {
    toolCalls = (message.tool_calls ?? []).map((call) => {
      const args = JSON.parse(call.function.arguments);
      if (!call.id || !call.function?.name || !isRecord(args)) throw new Error('invalid tool call');
      return { id: call.id, name: call.function.name, arguments: args };
    });
  } catch {
    return providerError(
      'provider_unavailable',
      'OpenAI API returned an invalid tool call.',
      false,
    );
  }

  if (
    message.content !== null &&
    message.content !== undefined &&
    typeof message.content !== 'string'
  ) {
    return providerError(
      'provider_unavailable',
      'OpenAI API returned unsupported response content.',
      false,
    );
  }
  const text = message.content ?? '';
  let structuredOutput;
  // Function-call turns precede the final structured response and may have null content.
  if (request.responseFormat && toolCalls.length === 0) {
    try {
      structuredOutput = JSON.parse(text);
      if (!isRecord(structuredOutput)) throw new Error('not an object');
    } catch {
      return providerError(
        'provider_unavailable',
        'OpenAI API returned invalid structured output.',
        false,
      );
    }
  }

  const finishReason =
    choice.finish_reason === 'tool_calls'
      ? 'tool_calls'
      : choice.finish_reason === 'length'
        ? 'length_limit'
        : choice.finish_reason === 'content_filter'
          ? 'content_filtered'
          : 'complete';
  return providerSuccess({
    text,
    toolCalls,
    ...(structuredOutput ? { structuredOutput } : {}),
    finishReason,
  });
}

/** Creates an evaluation-only provider; credentials and provider error bodies never enter outputs. */
function createOpenAIChatCompletionsProvider({
  apiKey,
  model,
  fetchImpl = globalThis.fetch,
  usageCollector = createTokenUsageCollector(),
  timeoutMs = 60_000,
}) {
  if (!apiKey || !model || typeof fetchImpl !== 'function') {
    throw new Error('OpenAI API provider configuration is incomplete.');
  }
  const provider = {
    kind: 'language-model',
    id: 'openai-api-evaluation',
    displayName: `OpenAI API evaluation (${model})`,
    capabilities: {
      inputTypes: ['text'],
      streaming: false,
      structuredOutput: true,
      toolCalling: true,
    },
    async generate(request) {
      const body = mapRequest(model, request);
      if (!body) {
        return providerError(
          'unsupported_input',
          'OpenAI API evaluation accepts text only.',
          false,
        );
      }

      usageCollector.beginRequest();
      let response;
      try {
        response = await fetchImpl(CHAT_COMPLETIONS_URL, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        usageCollector.markUnmeasured();
        return providerError('provider_unavailable', 'OpenAI API request failed.', true);
      }
      if (!response.ok) {
        usageCollector.markUnmeasured();
        const code =
          response.status === 401 || response.status === 403
            ? 'authentication_required'
            : response.status === 429
              ? 'rate_limited'
              : 'provider_unavailable';
        return providerError(
          code,
          'OpenAI API request failed.',
          response.status >= 500 || response.status === 429,
        );
      }

      let payload;
      try {
        payload = await response.json();
      } catch {
        usageCollector.markUnmeasured();
        return providerError(
          'provider_unavailable',
          'OpenAI API returned an invalid response.',
          false,
        );
      }
      usageCollector.record(payload?.usage);
      return mapResponse(payload, request);
    },
  };
  return { provider, getTokenUsage: () => usageCollector.snapshot() };
}

module.exports = {
  CHAT_COMPLETIONS_URL,
  createOpenAIChatCompletionsProvider,
  createTokenUsageCollector,
  mapRequest,
};
