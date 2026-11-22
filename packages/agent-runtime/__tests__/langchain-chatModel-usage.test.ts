import { createChatGPTPlanProvider } from '../../provider-openai/src/provider';
import { FakeBridge } from '../../provider-openai/__tests__/providerTestSupport';
import { InMemoryFakeLanguageModelProvider } from '@orot/model-runtime';
import { NativeStreamingChatModel } from '../src/langchain/streaming';
import { NativeChatModel } from '../src/langchain/chatModel';

describe('native chat reported usage', () => {
  it.each([
    { inputTokens: 123, outputTokens: 17, totalTokens: 140 },
    { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  ])(
    'carries terminal bridge counts through the real provider with one native request',
    async (usage) => {
      const bridge = new FakeBridge(async (requestId, native) => {
        native.emit({ requestId, type: 'text_delta', text: 'Answer' });
        native.emit({ requestId, type: 'completed', text: 'Answer', usage });
      });
      const provider = createChatGPTPlanProvider({
        bridge,
        issuedClientID: 'synthetic-account',
        model: { slug: 'synthetic', displayName: 'Synthetic' },
      });
      const model = new NativeChatModel(provider);
      const response = await model.invoke('Question');
      expect(response.usage_metadata).toEqual({
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        total_tokens: usage.totalTokens,
      });
      expect(response.content).toBe('Answer');
      expect(bridge.started).toHaveLength(1);
      expect(bridge.cancelled).toEqual([]);
    },
  );

  it.each([0, 7])('retains cache reads in both adapters: %p', async (cachedInputTokens) => {
    const usage = { inputTokens: 7, outputTokens: 2, totalTokens: 9, cachedInputTokens };
    const bridge = new FakeBridge(async (requestId, native) => {
      native.emit({ requestId, type: 'text_delta', text: 'Answer' });
      native.emit({ requestId, type: 'completed', text: 'Answer', usage });
    });
    const model = new NativeStreamingChatModel(
      createChatGPTPlanProvider({
        bridge,
        issuedClientID: 'synthetic-account',
        model: { slug: 'synthetic', displayName: 'Synthetic' },
      }),
    );
    const expected = {
      input_tokens: 7,
      output_tokens: 2,
      total_tokens: 9,
      input_token_details: { cache_read: cachedInputTokens },
    };
    expect((await model.invoke('Question')).usage_metadata).toEqual(expected);
    const chunks = [];
    for await (const chunk of await model.stream('Question')) chunks.push(chunk);
    expect(chunks.at(-1)?.usage_metadata).toEqual(expected);
  });

  it('keeps unreported usage absent rather than estimating from text', async () => {
    const model = new NativeChatModel(new InMemoryFakeLanguageModelProvider());
    const response = await model.invoke('Question with several words');
    expect(response.content).toContain('Question with several words');
    expect(response.usage_metadata).toBeUndefined();
  });

  it('does not reuse the previous invocation counts when the next terminal omits usage', async () => {
    let invocation = 0;
    const bridge = new FakeBridge(async (requestId, native) => {
      invocation += 1;
      native.emit({
        requestId,
        type: 'completed',
        text: '',
        ...(invocation === 1 ? { usage: { inputTokens: 7, outputTokens: 2, totalTokens: 9 } } : {}),
      });
    });
    const model = new NativeChatModel(
      createChatGPTPlanProvider({
        bridge,
        issuedClientID: 'synthetic-account',
        model: { slug: 'synthetic', displayName: 'Synthetic' },
      }),
    );
    expect((await model.invoke('Question')).usage_metadata).toEqual({
      input_tokens: 7,
      output_tokens: 2,
      total_tokens: 9,
    });
    expect((await model.invoke('Question')).usage_metadata).toBeUndefined();
    expect(bridge.started).toHaveLength(2);
  });

  it('does not invent a missing provider total', async () => {
    const provider = new InMemoryFakeLanguageModelProvider({
      response: {
        text: 'Answer',
        toolCalls: [],
        finishReason: 'complete',
        usage: { inputTokens: 12, outputTokens: 4 } as never,
      },
    });
    const generate = jest.spyOn(provider, 'generate');
    await expect(new NativeChatModel(provider).invoke('Question')).rejects.toMatchObject({
      code: 'internal_error',
    });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it.each(['pending', 'acknowledged'] as const)(
    'cancels the native request with registration %s and ignores late usage',
    async (registration) => {
      let started!: () => void;
      let register!: () => void;
      let registered!: () => void;
      const dispatched = new Promise<void>((resolve) => {
        started = resolve;
      });
      const allowRegistration = new Promise<void>((resolve) => {
        register = resolve;
      });
      const registeredNative = new Promise<void>((resolve) => {
        registered = resolve;
      });
      const active = new Set<string>();
      const bridge = new FakeBridge(async (requestId) => {
        started();
        await allowRegistration;
        active.add(requestId);
        registered();
      });
      const cancelNative = bridge.cancelResponse.bind(bridge);
      const reachedNative: boolean[] = [];
      jest.spyOn(bridge, 'cancelResponse').mockImplementation((requestId) => {
        reachedNative.push(active.delete(requestId));
        cancelNative(requestId);
      });

      const model = new NativeChatModel(
        createChatGPTPlanProvider({
          bridge,
          issuedClientID: 'synthetic-account',
          model: { slug: 'synthetic', displayName: 'Synthetic' },
        }),
      );
      // Registration and the provider start-promise continuation must both pass before
      // treating the bridge as acknowledged. This task boundary is not a timed delay.
      const acknowledge = async () => {
        register();
        await registeredNative;
        await new Promise<void>((resolve) => setImmediate(resolve));
      };
      const controller = new AbortController();
      const pending = model.invoke('Question', { signal: controller.signal });
      await dispatched;
      const [{ requestID }] = bridge.started;
      if (registration === 'acknowledged') await acknowledge();
      controller.abort();
      const lateUsage = () =>
        bridge.emit({
          requestId: requestID,
          type: 'completed',
          text: '',
          usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
        });
      lateUsage();
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      expect(bridge.cancelled).toEqual([requestID]);

      if (registration === 'pending') await acknowledge();
      lateUsage();
      expect(bridge.started).toHaveLength(1);
      expect(bridge.cancelled).toEqual(
        registration === 'pending' ? [requestID, requestID] : [requestID],
      );
      expect(reachedNative).toEqual(registration === 'pending' ? [false, true] : [true]);
      expect(active.size).toBe(0);
    },
  );
});
