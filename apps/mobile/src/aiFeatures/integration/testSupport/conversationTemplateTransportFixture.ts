import { AppleFoundationModelsProvider } from '@orot/provider-apple';
import type { LanguageModelRequest } from '@orot/model-runtime';
import {
  createChatGPTPlanProvider,
  type ChatGPTPlanNativeEvent,
  type ChatGPTPlanRequest,
} from '@orot/provider-openai';

/** The exact JS adapters receive a synthetic native protocol result; no model runs. */
export function syntheticTemplateTransport(
  route: 'apple' | 'chatgpt',
  intent: string,
  after: () => void,
) {
  const verdict = {
    id: 'synthetic-function',
    name: 'propose_conversation_template',
    arguments: { intent },
  };
  if (route === 'apple') {
    const generate = jest.fn(
      async (_request: LanguageModelRequest, _id: string) => {
        after();
        return {
          text: 'Never render this proposal prose.',
          finishReason: 'tool_calls' as const,
          toolCalls: [verdict],
        };
      },
    );
    const cancel = jest.fn();
    const provider = new AppleFoundationModelsProvider({
      getAvailability: async () => ({ status: 'available' }),
      generate,
      async *stream() {
        throw new Error('Unexpected route');
      },
      cancel,
    });
    return {
      provider,
      calls: () => generate.mock.calls.length,
      assertRequest(question: string) {
        const [wire, id] = generate.mock.calls[0]!;
        expect(wire.toolChoice).toBe('required');
        expect(
          wire.messages.filter(message => message.role !== 'system'),
        ).toEqual([{ role: 'user', content: question }]);
        expect(wire.tools).toHaveLength(1);
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(cancel).toHaveBeenCalledWith(id);
      },
    };
  }
  let receive: (event: ChatGPTPlanNativeEvent) => void = () => {};
  const start = jest.fn(
    async (
      requestId: string,
      _account: string,
      _request: ChatGPTPlanRequest,
    ) => {
      const text = 'Never render this proposal prose.';
      receive({ requestId, type: 'text_delta', text });
      receive({
        requestId,
        type: 'completed',
        text,
        toolCalls: [
          { ...verdict, arguments: JSON.stringify(verdict.arguments) },
        ],
      });
      after();
    },
  );
  const provider = createChatGPTPlanProvider({
    issuedClientID: 'synthetic',
    model: { slug: 'selected-model', displayName: 'Selected Model' },
    bridge: {
      listModels: async () => [],
      subscribe(callback) {
        receive = callback;
        return () => {};
      },
      startResponse: start,
      cancelResponse: jest.fn(),
    },
  });
  return {
    provider,
    calls: () => start.mock.calls.length,
    assertRequest(question: string) {
      const [, account, wire] = start.mock.calls[0]!;
      expect(account).toBe('synthetic');
      expect(wire.model).toBe('selected-model');
      expect(wire.toolChoice).toBe('required');
      expect(
        wire.messages.filter(
          message => 'role' in message && message.role !== 'system',
        ),
      ).toEqual([{ role: 'user', content: question }]);
      expect(wire.tools).toHaveLength(1);
    },
  };
}
