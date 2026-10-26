import {
  providerSuccess,
  type LanguageModelProvider,
  type LanguageModelRequest,
} from '@orot/model-runtime';
import { invokeProductionRequest } from '../src/langchain/production';
import * as conversion from '../src/langchain/messages';

const response = { text: 'answer', toolCalls: [], finishReason: 'complete' as const };
function fixture() {
  const generate = jest.fn(async (_request: LanguageModelRequest) => providerSuccess(response));
  const stream = jest.fn(async function* (_request: LanguageModelRequest) {
    yield providerSuccess({ type: 'completed' as const, response });
  });
  const provider: LanguageModelProvider = {
    id: 'synthetic',
    kind: 'language-model',
    displayName: 'Synthetic',
    capabilities: {
      inputTypes: ['text'],
      streaming: true,
      structuredOutput: false,
      toolCalling: true,
    },
    generate,
    stream,
  };
  return { provider, generate, stream };
}

it.each([false, true])(
  'preserves explicitly empty approved tool collections with streaming=%s',
  async (streaming) => {
    const { provider, generate, stream } = fixture();
    const request: LanguageModelRequest = {
      messages: [
        { role: 'assistant', content: 'prior', toolCalls: [] },
        { role: 'user', content: 'next' },
      ],
      tools: [],
    };
    await expect(invokeProductionRequest(provider, request, undefined, streaming)).resolves.toEqual(
      response,
    );
    const dispatch = streaming ? stream : generate;
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]?.[0]).toEqual(request);
  },
);

it.each([false, true])(
  'rejects changed approved data before dispatch with streaming=%s',
  async (streaming) => {
    const { provider, generate, stream } = fixture();
    // Simulate a faulty conversion, not a provider reply; the consent guard must fail before native use.
    const changed = jest
      .spyOn(conversion, 'toNativeMessages')
      .mockReturnValueOnce({ messages: [{ role: 'user', content: 'different' }], metadata: [] });
    try {
      await expect(
        invokeProductionRequest(
          provider,
          { messages: [{ role: 'user', content: 'approved' }] },
          undefined,
          streaming,
        ),
      ).rejects.toMatchObject({ code: 'invalid_request' });
      expect(generate).not.toHaveBeenCalled();
      expect(stream).not.toHaveBeenCalled();
    } finally {
      changed.mockRestore();
    }
  },
);
