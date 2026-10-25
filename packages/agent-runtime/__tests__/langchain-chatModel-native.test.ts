import { AppleFoundationModelsProvider } from '../../provider-apple/src/provider';
import type { AppleFoundationModelsNativeBridge } from '../../provider-apple/src/types';
import { NativeChatModel } from '../src/langchain/chatModel';

// Exercise the real provider adapter over a synthetic native port. This proves dispatch and
// cancellation wiring, not Apple model availability or inference on a device.
function fixture() {
  const native: jest.Mocked<AppleFoundationModelsNativeBridge> = {
    getAvailability: jest.fn().mockResolvedValue({ status: 'available' }),
    generate: jest
      .fn()
      .mockResolvedValue({ text: 'Native answer', toolCalls: [], finishReason: 'complete' }),
    stream: jest.fn(),
    cancel: jest.fn(),
  };
  return { native, model: new NativeChatModel(new AppleFoundationModelsProvider(native)) };
}

describe('chat model native bridge wiring', () => {
  it('dispatches exactly one native generation per invocation without using native streaming', async () => {
    const { native, model } = fixture();
    const response = await model.invoke('Question');
    expect(response.content).toBe('Native answer');
    // Apple currently reports no usage; a successful response must not manufacture token counts.
    expect(response.usage_metadata).toBeUndefined();
    expect(native.generate).toHaveBeenCalledTimes(1);
    expect(native.generate).toHaveBeenCalledWith(
      { messages: [{ role: 'user', content: 'Question' }] },
      expect.any(String),
    );
    expect(native.stream).not.toHaveBeenCalled();
    expect(native.cancel).not.toHaveBeenCalled();
  });

  it('cancels the same native request once and does not deliver its late response', async () => {
    const { native, model } = fixture();
    let started!: () => void;
    const dispatched = new Promise<void>((resolve) => {
      started = resolve;
    });
    let finish!: (value: { text: string; toolCalls: []; finishReason: 'complete' }) => void;
    native.generate.mockImplementationOnce(() => {
      started();
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const controller = new AbortController();
    const pending = model.invoke('Question', { signal: controller.signal });
    await dispatched;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(native.generate).toHaveBeenCalledTimes(1);
    expect(native.cancel).toHaveBeenCalledTimes(1);
    expect(native.cancel).toHaveBeenCalledWith(native.generate.mock.calls[0][1]);
    finish({ text: 'Late answer', toolCalls: [], finishReason: 'complete' });
    await Promise.resolve();
    expect(native.cancel).toHaveBeenCalledTimes(1);
  });

  it('preserves availability failures without attempting native generation', async () => {
    const { native, model } = fixture();
    native.getAvailability.mockResolvedValue({ status: 'modelNotReady' });
    await expect(model.invoke('Question')).rejects.toMatchObject({
      code: 'provider_unavailable',
      retryable: true,
    });
    expect(native.getAvailability).toHaveBeenCalledTimes(1);
    expect(native.generate).not.toHaveBeenCalled();
  });
});
