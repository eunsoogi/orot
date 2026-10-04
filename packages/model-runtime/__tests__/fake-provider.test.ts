import { describe, expect, it } from '@jest/globals';
import {
  InMemoryFakeLanguageModelProvider,
  type LanguageModelRequest,
  type LanguageModelResponse,
  type LanguageModelStreamEvent,
  type ToolCall,
} from '../src';

const textRequest = (text: string): LanguageModelRequest => ({
  messages: [{ role: 'user', content: text }],
});

describe('InMemoryFakeLanguageModelProvider', () => {
  it('returns the same normalized response for the same input', async () => {
    const provider = new InMemoryFakeLanguageModelProvider();
    const request = textRequest('Summarize this visit.');
    const expected = {
      ok: true,
      value: {
        text: 'Fake response: Summarize this visit.',
        toolCalls: [],
        finishReason: 'complete',
      },
    };

    await expect(provider.generate(request)).resolves.toEqual(expected);
    await expect(provider.generate(request)).resolves.toEqual(expected);
  });

  it('returns normalized tool calls and structured output without SDK fields', async () => {
    const toolCall: ToolCall = { id: 'call-1', name: 'lookup', arguments: { query: 'visit' } };
    const response: LanguageModelResponse = {
      text: '',
      toolCalls: [toolCall],
      structuredOutput: { status: 'found' },
      finishReason: 'tool_calls',
    };
    const provider = new InMemoryFakeLanguageModelProvider({
      capabilities: { structuredOutput: true },
      response,
    });
    const request: LanguageModelRequest = {
      messages: [
        { role: 'assistant', content: '', toolCalls: [toolCall] },
        { role: 'tool', toolCallId: 'call-1', result: { count: 1 } },
      ],
      tools: [{ name: 'lookup', inputSchema: { type: 'object' } }],
      responseFormat: { name: 'LookupResult', schema: { type: 'object' } },
    };

    await expect(provider.generate(request)).resolves.toEqual({ ok: true, value: response });
  });

  it('returns stable capability errors for unsupported audio, tools, and structured output', async () => {
    const provider = new InMemoryFakeLanguageModelProvider({
      capabilities: {
        inputTypes: ['text'],
        toolCalling: false,
        structuredOutput: false,
      },
    });
    const audioRequest: LanguageModelRequest = {
      messages: [
        {
          role: 'user',
          content: [{ type: 'audio', data: new Uint8Array([1]), mediaType: 'audio/wav' }],
        },
      ],
    };
    const toolRequest: LanguageModelRequest = {
      ...textRequest('Use lookup.'),
      tools: [{ name: 'lookup', inputSchema: { type: 'object' } }],
    };
    const structuredRequest: LanguageModelRequest = {
      ...textRequest('Return JSON.'),
      responseFormat: { name: 'Answer', schema: { type: 'object' } },
    };

    await expect(provider.generate(audioRequest)).resolves.toMatchObject({
      ok: false,
      error: { code: 'unsupported_input', retryable: false },
    });
    await expect(provider.generate(toolRequest)).resolves.toMatchObject({
      ok: false,
      error: { code: 'unsupported_capability', retryable: false },
    });
    await expect(provider.generate(structuredRequest)).resolves.toMatchObject({
      ok: false,
      error: { code: 'unsupported_capability', retryable: false },
    });
  });

  it('streams normalized text and the final response, or returns an unsupported error', async () => {
    const response: LanguageModelResponse = {
      text: 'ready',
      toolCalls: [],
      finishReason: 'complete',
    };
    const provider = new InMemoryFakeLanguageModelProvider({ response });
    const events: LanguageModelStreamEvent[] = [];
    for await (const result of provider.stream(textRequest('start'))) {
      if (result.ok) events.push(result.value);
    }
    expect(events).toEqual([
      { type: 'text_delta', text: 'ready' },
      { type: 'completed', response },
    ]);

    const nonStreaming = new InMemoryFakeLanguageModelProvider({
      capabilities: { streaming: false },
    });
    const results = [];
    for await (const result of nonStreaming.stream(textRequest('start'))) results.push(result);
    expect(results).toMatchObject([{ ok: false, error: { code: 'unsupported_capability' } }]);
  });

  it('returns a configured normalized provider error unchanged', async () => {
    const error = { code: 'rate_limited', message: 'Try again later.', retryable: true } as const;
    const provider = new InMemoryFakeLanguageModelProvider({ error });

    await expect(provider.generate(textRequest('Try again.'))).resolves.toEqual({
      ok: false,
      error,
    });
  });
});
