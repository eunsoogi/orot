import { AppleOnDeviceSpeechProvider } from '../index';
import {
  FakeNativeSpeechBridge,
  transcript,
  transcriptionRequest,
} from '../testSupport/providerFixtures';

// Pending native promises expose whether cancellation returns without waiting for system completion.
describe('AppleOnDeviceSpeechProvider cancellation', () => {
  it('cancels the active native request when its caller aborts', async () => {
    const native = new FakeNativeSpeechBridge();
    const provider = new AppleOnDeviceSpeechProvider(native);
    const controller = new AbortController();
    let releaseNative: ((response: typeof transcript) => void) | undefined;
    let markStarted!: () => void;
    const started = new Promise<void>(resolve => {
      markStarted = resolve;
    });
    jest.spyOn(native, 'transcribe').mockImplementation(request => {
      native.requests.push(request);
      markStarted();
      return new Promise(resolve => {
        releaseNative = resolve;
      });
    });
    const operation = provider.transcribe({
      ...transcriptionRequest(),
      signal: controller.signal,
    });

    await started;
    controller.abort();
    const result = await Promise.race([
      operation,
      new Promise<undefined>(resolve =>
        setTimeout(() => resolve(undefined), 50),
      ),
    ]);
    releaseNative?.(transcript);
    await operation;

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'provider_unavailable',
        message: expect.stringContaining('TRANSCRIPTION_CANCELLED:'),
        retryable: false,
      },
    });
    expect(native.cancelledRequests).toEqual([
      (native.requests[0] as unknown as { requestId: string }).requestId,
    ]);
  });

  it('returns a bounded timeout and cancels a native request that never settles', async () => {
    jest.useFakeTimers();
    const native = new FakeNativeSpeechBridge();
    const provider = new AppleOnDeviceSpeechProvider(native);
    let releaseNative: ((response: typeof transcript) => void) | undefined;
    let markStarted!: () => void;
    const started = new Promise<void>(resolve => {
      markStarted = resolve;
    });
    jest.spyOn(native, 'transcribe').mockImplementation(request => {
      native.requests.push(request);
      markStarted();
      return new Promise(resolve => {
        releaseNative = resolve;
      });
    });
    const operation = provider.transcribe(transcriptionRequest());
    let result: Awaited<typeof operation> | undefined;
    operation.then(value => {
      result = value;
    });

    await started;
    try {
      await jest.advanceTimersByTimeAsync(120_000);
      await Promise.resolve();
      releaseNative?.(transcript);
      await operation;

      expect(result).toMatchObject({
        ok: false,
        error: {
          code: 'provider_unavailable',
          message: expect.stringContaining('TRANSCRIPTION_TIMEOUT:'),
          retryable: true,
        },
      });
      expect(native.cancelledRequests).toEqual([
        (native.requests[0] as unknown as { requestId: string }).requestId,
      ]);
    } finally {
      releaseNative?.(transcript);
      jest.useRealTimers();
    }
  });
});
