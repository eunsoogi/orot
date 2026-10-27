'use strict';

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeMessages(messages) {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return {
        role: 'tool',
        toolCallId: message.tool_call_id,
        result: parseJson(message.content),
      };
    }
    if (message.role !== 'assistant') return { role: message.role, content: message.content ?? '' };
    return {
      role: 'assistant',
      content: message.content ?? '',
      ...(message.tool_calls?.length
        ? {
            toolCalls: message.tool_calls.map((call) => ({
              id: call.id,
              name: call.function.name,
              arguments: JSON.parse(call.function.arguments),
            })),
          }
        : {}),
    };
  });
}

/** Adapts native tool turns and records scripted-provider outcomes before building OpenAI responses. */
function createOpenAITestFetch(provider, calls) {
  return async (url, options) => {
    const call = { url, authorization: options.headers.authorization };
    calls.push(call);
    const body = JSON.parse(options.body);
    let response;
    try {
      response = await provider.generate({
        messages: normalizeMessages(body.messages),
        tools: (body.tools ?? []).map((tool) => ({
          name: tool.function.name,
          description: tool.function.description,
          inputSchema: tool.function.parameters,
        })),
      });
      call.providerOutcome = response?.ok ? 'returned' : 'failed';
      if (!response?.ok) call.providerErrorCode = response?.error?.code ?? 'unknown';
    } catch (error) {
      call.providerOutcome = 'threw';
      call.providerError = error instanceof Error ? error.message : 'Unknown provider error.';
      throw error;
    }
    const result = response.value;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              role: 'assistant',
              content: result.text || null,
              ...(result.toolCalls.length
                ? {
                    tool_calls: result.toolCalls.map((call) => ({
                      id: call.id,
                      type: 'function',
                      function: { name: call.name, arguments: JSON.stringify(call.arguments) },
                    })),
                  }
                : {}),
            },
            finish_reason: result.finishReason === 'tool_calls' ? 'tool_calls' : 'stop',
          },
        ],
        usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
      }),
    };
  };
}

module.exports = { createOpenAITestFetch, normalizeMessages };
