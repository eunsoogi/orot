import type { LanguageModelProvider, LanguageModelRequest } from '@orot/model-runtime';
import { providerFailure, providerSuccess } from '@orot/model-runtime';
import { NativeChatModelError } from '../src/langchain/chatModel';
import { NativeToolBindingChatModel } from '../src/langchain/toolBinding';

const searchTool = {
  type: 'function',
  function: {
    name: 'search_records',
    description: 'Search records.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
} as const;

function fixture(toolCalling = true) {
  const requests: LanguageModelRequest[] = [];
  const generate = jest.fn(async (request: LanguageModelRequest) => {
    requests.push(request);
    return providerSuccess({
      text: '',
      toolCalls: [{ id: 'native-call-7', name: 'search_records', arguments: { query: 'pulse' } }],
      finishReason: 'tool_calls' as const,
    });
  });
  const capabilities = {
    inputTypes: ['text'] as const,
    streaming: false,
    structuredOutput: false,
    toolCalling,
  };
  const provider: LanguageModelProvider = {
    id: 'selected-provider',
    kind: 'language-model',
    displayName: 'Selected provider',
    capabilities,
    generate,
  };
  return { capabilities, generate, provider, requests };
}

describe('native chat tool binding', () => {
  it('sends only the function schema and returns native call IDs with parsed arguments', async () => {
    const { capabilities, generate, provider, requests } = fixture();
    const execute = jest.fn();
    const bound = new NativeToolBindingChatModel(provider).bindTools([
      { ...searchTool, invoke: execute },
    ]);

    const response = await bound.invoke('Find my pulse record.');

    expect(response.tool_calls).toEqual([
      {
        type: 'tool_call',
        id: 'native-call-7',
        name: 'search_records',
        args: { query: 'pulse' },
      },
    ]);
    expect(requests[0]).toEqual({
      messages: [{ role: 'user', content: 'Find my pulse record.' }],
      tools: [
        {
          name: 'search_records',
          description: 'Search records.',
          inputSchema: searchTool.function.parameters,
        },
      ],
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
    expect(capabilities.toolCalling).toBe(true);
  });

  it('maps provider-selected and disabled tool choices without inventing provider controls', async () => {
    const required = fixture();
    await new NativeToolBindingChatModel(required.provider)
      .bindTools([searchTool], { tool_choice: 'any' })
      .invoke('Search now.');
    expect(required.requests[0]?.toolChoice).toBe('required');

    const disabled = fixture();
    await new NativeToolBindingChatModel(disabled.provider)
      .bindTools([searchTool])
      .invoke('Answer without tools.', { tool_choice: 'none' });
    expect(disabled.requests[0]).toEqual({
      messages: [{ role: 'user', content: 'Answer without tools.' }],
    });
  });

  it('preserves a native rejection of required tool choice without retrying as automatic', async () => {
    const { generate, provider } = fixture();
    generate.mockResolvedValueOnce(
      providerFailure({
        code: 'unsupported_capability',
        message: 'private provider diagnostic',
        retryable: false,
      }),
    );
    const bound = new NativeToolBindingChatModel(provider).bindTools([searchTool], {
      tool_choice: 'required',
    });

    await expect(bound.invoke('Search now.')).rejects.toMatchObject({
      code: 'unsupported_capability',
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0]?.[0].toolChoice).toBe('required');
  });

  it.each([
    ['a named tool', 'search_records'],
    ['a custom choice object', { type: 'function', function: { name: 'search_records' } }],
  ])('rejects %s before provider dispatch', async (_label, toolChoice) => {
    const { generate, provider } = fixture();
    const bound = new NativeToolBindingChatModel(provider).bindTools([searchTool]);

    await expect(bound.invoke('Search now.', { tool_choice: toolChoice })).rejects.toMatchObject({
      code: 'unsupported_capability',
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it('rejects tool binding when the selected provider does not support tools', () => {
    const { generate, provider } = fixture(false);
    let error: unknown;
    try {
      new NativeToolBindingChatModel(provider).bindTools([searchTool]);
    } catch (value) {
      error = value;
    }

    expect(error).toBeInstanceOf(NativeChatModelError);
    expect(error).toMatchObject({ code: 'unsupported_capability' });
    expect(generate).not.toHaveBeenCalled();
  });

  it.each([
    { type: 'web_search', name: 'search_records' },
    { ...searchTool, function: { ...searchTool.function, strict: true } },
  ])('rejects tool formats whose semantics the native contract cannot preserve', (tool) => {
    const { provider } = fixture();
    let error: unknown;
    try {
      new NativeToolBindingChatModel(provider).bindTools([tool]);
    } catch (value) {
      error = value;
    }

    expect(error).toBeInstanceOf(NativeChatModelError);
    expect(error).toMatchObject({ code: 'unsupported_capability' });
  });
});
