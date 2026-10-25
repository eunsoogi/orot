import { createOpenAIPlanProvider } from '../openai';

let mockNativeListener: (event: unknown) => void;
let mockUsage: unknown;
const mockStartResponse = jest.fn((_request: unknown, requestId: string) => {
  mockNativeListener({ requestId, packet: { type: 'completed', text: '', usage: mockUsage } });
});
const mockCancelResponse = jest.fn();
const mockRemove = jest.fn();

// Use the app's real packet validation and provider, replacing only the untyped native transport.
jest.mock('react-native', () => ({
  NativeModules: { OpenAIProviderModule: {
    addListener: jest.fn(), removeListeners: jest.fn(),
    startResponse: (...args: [unknown, string]) => mockStartResponse(...args),
    cancelResponse: (id: string) => mockCancelResponse(id),
  } },
  NativeEventEmitter: jest.fn().mockImplementation(() => ({
    addListener: (_name: string, listener: (event: unknown) => void) => {
      mockNativeListener = listener;
      return { remove: mockRemove };
    },
  })),
}));

describe('OpenAI native usage packet boundary', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it.each([
    { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
    { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  ])('passes only valid reported counts into the real provider', async usage => {
    mockUsage = usage;
    const provider = createOpenAIPlanProvider('synthetic-account', { slug: 'synthetic', displayName: 'Synthetic' });
    await expect(provider.generate({ messages: [{ role: 'user', content: 'Question' }] })).resolves.toMatchObject({ ok: true, value: { usage } });
    expect(mockStartResponse).toHaveBeenCalledTimes(1);
    expect(mockCancelResponse).not.toHaveBeenCalled();
    expect(mockRemove).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, null])('does not infer usage when native counts are absent: %p', async usage => {
    mockUsage = usage;
    const provider = createOpenAIPlanProvider('synthetic-account', { slug: 'synthetic', displayName: 'Synthetic' });
    const response = await provider.generate({ messages: [{ role: 'user', content: 'Question' }] });
    expect(response).toEqual({ ok: true, value: { text: '', toolCalls: [], finishReason: 'complete' } });
    expect(mockStartResponse).toHaveBeenCalledTimes(1);
  });

  it.each([
    { inputTokens: 1, outputTokens: 2 },
    { inputTokens: '1', outputTokens: 2, totalTokens: 3 },
    { inputTokens: true, outputTokens: 2, totalTokens: 3 },
    { inputTokens: -1, outputTokens: 2, totalTokens: 1 },
    { inputTokens: 1.5, outputTokens: 2, totalTokens: 3.5 },
    { inputTokens: Number.MAX_SAFE_INTEGER + 1, outputTokens: 0, totalTokens: Number.MAX_SAFE_INTEGER + 1 },
  ])('rejects malformed native counts without a second request: %p', async usage => {
    mockUsage = usage;
    const provider = createOpenAIPlanProvider('synthetic-account', { slug: 'synthetic', displayName: 'Synthetic' });
    await expect(provider.generate({ messages: [{ role: 'user', content: 'Question' }] })).resolves.toMatchObject({ ok: false, error: { code: 'internal_error', retryable: false } });
    expect(mockStartResponse).toHaveBeenCalledTimes(1);
    expect(mockCancelResponse).toHaveBeenCalledTimes(1);
    expect(mockRemove).toHaveBeenCalledTimes(1);
  });
});
