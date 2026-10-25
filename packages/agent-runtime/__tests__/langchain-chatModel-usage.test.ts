import { createChatGPTPlanProvider } from '../../provider-openai/src/provider';
import { FakeBridge } from '../../provider-openai/__tests__/providerTestSupport';
import { InMemoryFakeLanguageModelProvider } from '@orot/model-runtime';
import { NativeChatModel } from '../src/langchain/chatModel';

describe('native chat reported usage', () => {
  it.each([
    { inputTokens: 123, outputTokens: 17, totalTokens: 140 },
    { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  ])('carries terminal bridge counts through the real provider with one native request', async (usage) => {
    const bridge = new FakeBridge(async (requestId, native) => {
      native.emit({ requestId, type: 'text_delta', text: 'Answer' });
      native.emit({ requestId, type: 'completed', text: 'Answer', usage });
    });
    const provider = createChatGPTPlanProvider({
      bridge, issuedClientID: 'synthetic-account', model: { slug: 'synthetic', displayName: 'Synthetic' },
    });
    const model = new NativeChatModel(provider);
    const response = await model.invoke('Question');
    expect(response.usage_metadata).toEqual({
      input_tokens: usage.inputTokens, output_tokens: usage.outputTokens, total_tokens: usage.totalTokens,
    });
    expect(response.content).toBe('Answer');
    expect(bridge.started).toHaveLength(1);
    expect(bridge.cancelled).toEqual([]);
  });

  it('keeps unreported usage absent rather than estimating from text', async () => {
    const model = new NativeChatModel(new InMemoryFakeLanguageModelProvider());
    const response = await model.invoke('Question with several words');
    expect(response.content).toContain('Question with several words');
    expect(response.usage_metadata).toBeUndefined();
  });

  it('does not invent a missing provider total', async () => {
    const provider = new InMemoryFakeLanguageModelProvider({ response: {
      text: 'Answer', toolCalls: [], finishReason: 'complete',
      usage: { inputTokens: 12, outputTokens: 4 } as never,
    } });
    const generate = jest.spyOn(provider, 'generate');
    await expect(new NativeChatModel(provider).invoke('Question')).rejects.toMatchObject({ code: 'internal_error' });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('cancels the native request and ignores usage arriving after cancellation', async () => {
    let started!: () => void;
    const dispatched = new Promise<void>((resolve) => { started = resolve; });
    const bridge = new FakeBridge(async () => { started(); });
    const model = new NativeChatModel(createChatGPTPlanProvider({
      bridge, issuedClientID: 'synthetic-account', model: { slug: 'synthetic', displayName: 'Synthetic' },
    }));
    const controller = new AbortController();
    const pending = model.invoke('Question', { signal: controller.signal });
    await dispatched;
    controller.abort();
    bridge.emit({ requestId: bridge.started[0].requestID, type: 'completed', text: '',
      usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
    });
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(bridge.started).toHaveLength(1);
    expect(bridge.cancelled).toHaveLength(1);
  });
});
