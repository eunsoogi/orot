import { createChatGPTPlanProvider } from '../src/provider';
import { FakeBridge, baseRequest } from './providerTestSupport';
import type { ChatGPTPlanNativeEvent } from '../src/native-contract';

function fixture(usage: unknown) {
  const bridge = new FakeBridge(async (requestId, target) => {
    target.emit({ requestId, type: 'completed', text: '', usage } as ChatGPTPlanNativeEvent);
  });
  return { bridge, provider: createChatGPTPlanProvider({
    bridge, issuedClientID: 'synthetic-account', model: { slug: 'synthetic', displayName: 'Synthetic' },
  }) };
}

describe('ChatGPT terminal token usage', () => {
  it.each([undefined, null])('keeps absent usage absent: %p', async (usage) => {
    const { provider, bridge } = fixture(usage);
    const result = await provider.generate(baseRequest);
    expect(result).toEqual({ ok: true, value: { text: '', toolCalls: [], finishReason: 'complete' } });
    expect(bridge.started).toHaveLength(1);
  });

  it('copies the closed usage shape in stream and generate responses', async () => {
    const usage = { inputTokens: 9, outputTokens: 3, totalTokens: 12 };
    const { provider, bridge } = fixture({ ...usage, privateDiagnostic: 'discard' });
    await expect(provider.generate(baseRequest)).resolves.toMatchObject({ ok: true, value: { usage } });
    const events = [];
    for await (const event of provider.stream!(baseRequest)) events.push(event);
    expect(events).toEqual([{ ok: true, value: { type: 'completed', response: {
      text: '', toolCalls: [], finishReason: 'complete', usage,
    } } }]);
    expect(bridge.started).toHaveLength(2);
    expect(bridge.cancelled).toEqual([]);
  });

  it.each([
    [], true, 'usage', {}, { inputTokens: 1, outputTokens: 2 },
    { inputTokens: true, outputTokens: 2, totalTokens: 3 },
    { inputTokens: '1', outputTokens: 2, totalTokens: 3 },
    { inputTokens: -1, outputTokens: 2, totalTokens: 1 },
    { inputTokens: 1.5, outputTokens: 2, totalTokens: 3.5 },
    { inputTokens: Infinity, outputTokens: 2, totalTokens: Infinity },
    { inputTokens: Number.MAX_SAFE_INTEGER + 1, outputTokens: 0, totalTokens: Number.MAX_SAFE_INTEGER + 1 },
  ])('rejects malformed usage without a retry: %p', async (usage) => {
    const { provider, bridge } = fixture(usage);
    await expect(provider.generate(baseRequest)).resolves.toMatchObject({ ok: false, error: { code: 'internal_error', retryable: false } });
    expect(bridge.started).toHaveLength(1);
  });
});
