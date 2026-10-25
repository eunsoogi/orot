import { describe, expect, it } from '@jest/globals';

const {
  createOpenAIChatCompletionsProvider,
  createTokenUsageCollector,
} = require('../../../scripts/evaluation/visit-questions/openai-api-provider.cjs');

function makeResponse(payload: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => payload,
  };
}

describe('OpenAI Chat Completions evaluation provider', () => {
  it('maps model-runtime requests and preserves response text and measured usage', async () => {
    const calls: Array<{ url: string; options: any; body: any }> = [];
    const usage = createTokenUsageCollector();
    const { provider, getTokenUsage } = createOpenAIChatCompletionsProvider({
      apiKey: 'synthetic-test-key',
      model: 'model-test',
      fetchImpl: async (url: string, options: any) => {
        calls.push({ url, options, body: JSON.parse(options.body) });
        return makeResponse({
          choices: [
            {
              message: { role: 'assistant', content: '{"type":"result"}' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 },
        });
      },
      usageCollector: usage,
    });

    const response = await provider.generate({
      messages: [
        { role: 'system', content: 'synthetic instructions' },
        { role: 'user', content: 'synthetic visit question' },
      ],
      tools: [
        {
          name: 'evidence_search',
          description: 'Search synthetic evidence.',
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
            additionalProperties: false,
          },
        },
      ],
      responseFormat: {
        name: 'visit_result',
        // The real graph uses a root oneOf; the provider uses JSON mode and the graph validates locally.
        schema: { oneOf: [{ type: 'object', properties: { type: { type: 'string' } } }] },
      },
      maxOutputTokens: 256,
      temperature: 0,
    });

    expect(response).toEqual({
      ok: true,
      value: {
        text: '{"type":"result"}',
        toolCalls: [],
        structuredOutput: { type: 'result' },
        finishReason: 'complete',
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.openai.com/v1/chat/completions');
    expect(calls[0].options.headers.authorization).toBe('Bearer synthetic-test-key');
    expect(calls[0].body).toMatchObject({
      model: 'model-test',
      messages: [
        { role: 'system', content: expect.stringContaining('synthetic instructions') },
        { role: 'user', content: 'synthetic visit question' },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'evidence_search',
            description: 'Search synthetic evidence.',
            parameters: {
              type: 'object',
              properties: { query: { type: 'string' } },
              required: ['query'],
              additionalProperties: false,
            },
          },
        },
      ],
      response_format: { type: 'json_object' },
      max_completion_tokens: 256,
      temperature: 0,
    });
    expect(calls[0].body.tools[0].function).not.toHaveProperty('strict');
    expect(getTokenUsage()).toEqual({ inputTokens: 12, outputTokens: 7, totalTokens: 19 });
  });

  it('maps tool calls and aggregates only complete usage returned by every API response', async () => {
    const payloads = [
      {
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call-1',
                  type: 'function',
                  function: { name: 'evidence_search', arguments: '{"query":"sleep"}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
      },
      {
        choices: [{ message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 6, completion_tokens: 2, total_tokens: 8 },
      },
    ];
    const { provider, getTokenUsage } = createOpenAIChatCompletionsProvider({
      apiKey: 'synthetic-test-key',
      model: 'model-test',
      fetchImpl: async () => makeResponse(payloads.shift()),
      usageCollector: createTokenUsageCollector(),
    });

    const toolResponse = await provider.generate({
      messages: [
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call-old', name: 'evidence_search', arguments: { query: 'sleep' } }],
        },
        { role: 'tool', toolCallId: 'call-old', result: { count: 1 } },
      ],
    });
    const textResponse = await provider.generate({
      messages: [{ role: 'user', content: 'answer' }],
    });

    expect(toolResponse).toMatchObject({
      ok: true,
      value: {
        toolCalls: [{ id: 'call-1', name: 'evidence_search', arguments: { query: 'sleep' } }],
        finishReason: 'tool_calls',
      },
    });
    expect(textResponse).toMatchObject({ ok: true, value: { text: 'done' } });
    expect(getTokenUsage()).toEqual({ inputTokens: 16, outputTokens: 6, totalTokens: 22 });
  });

  it('keeps tool-call responses when a structured response is requested', async () => {
    const { provider } = createOpenAIChatCompletionsProvider({
      apiKey: 'synthetic-test-key',
      model: 'model-test',
      fetchImpl: async () =>
        makeResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call-1',
                    type: 'function',
                    function: { name: 'evidence_search', arguments: '{"query":"sleep"}' },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
          usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
        }),
    });

    const response = await provider.generate({
      messages: [{ role: 'user', content: 'synthetic query' }],
      responseFormat: { name: 'response', schema: { type: 'object' } },
    });

    expect(response).toMatchObject({
      ok: true,
      value: {
        text: '',
        toolCalls: [{ id: 'call-1', name: 'evidence_search', arguments: { query: 'sleep' } }],
        finishReason: 'tool_calls',
      },
    });
  });

  it('marks usage unmeasured when an API response omits complete counts or fails', async () => {
    const usage = createTokenUsageCollector();
    const captured: any[] = [];
    const payloads = [
      {
        choices: [{ message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
      },
      { error: { message: 'private provider response text' } },
    ];
    const { provider, getTokenUsage } = createOpenAIChatCompletionsProvider({
      apiKey: 'synthetic-test-key',
      model: 'model-test',
      fetchImpl: async (_url: string, options: any) => {
        captured.push(options);
        const failed = captured.length === 2;
        return makeResponse(payloads.shift(), !failed, failed ? 500 : 200);
      },
      usageCollector: usage,
    });

    const response = await provider.generate({
      messages: [{ role: 'user', content: 'synthetic' }],
    });
    expect(response).toMatchObject({ ok: true });
    const failedResponse = await provider.generate({
      messages: [{ role: 'user', content: 'synthetic' }],
    });
    expect(failedResponse.ok).toBe(false);
    expect(failedResponse).not.toHaveProperty('error.message', 'private provider response text');
    expect(getTokenUsage()).toBeNull();
  });

  it('rejects inconsistent or unsafe token totals instead of deriving a replacement', () => {
    const inconsistent = createTokenUsageCollector();
    inconsistent.record({ prompt_tokens: 8, completion_tokens: 3, total_tokens: 12 });
    const unsafeInteger = createTokenUsageCollector();
    unsafeInteger.record({
      prompt_tokens: Number.MAX_SAFE_INTEGER + 1,
      completion_tokens: 0,
      total_tokens: Number.MAX_SAFE_INTEGER + 1,
    });

    expect(inconsistent.snapshot()).toBeNull();
    expect(unsafeInteger.snapshot()).toBeNull();
  });
});
