import type {
  NativeSpeechTranscriptionBridge,
  NativeSpeechTranscriptionResponse,
} from '../types';
import { createSyntheticFixtureNativeBridge } from '../testSupport/syntheticFixtureBridge';

describe('synthetic speech fixture bridge', () => {
  it('preserves request identity and forwards cancellation to native speech', async () => {
    const response = {} as NativeSpeechTranscriptionResponse;
    const native: NativeSpeechTranscriptionBridge = {
      getAvailability: jest.fn(async () => ({
        status: 'available' as const,
        engine: 'speech_transcriber' as const,
        locale: 'ko-KR',
      })),
      transcribe: jest.fn(async () => response),
      cancelTranscription: jest.fn(),
    };
    const bridge = createSyntheticFixtureNativeBridge(native, true);
    const request = {
      requestId: 'synthetic-speech-fixture-1',
      audioBase64: 'fixture-audio',
      mediaType: 'audio/wav',
      language: 'ko-KR',
    };

    await bridge.transcribe(request);
    expect(native.transcribe).toHaveBeenCalledWith({
      ...request,
      syntheticFixture: true,
    });
    expect(bridge.cancelTranscription).toEqual(expect.any(Function));
    bridge.cancelTranscription?.(request.requestId);
    expect(native.cancelTranscription).toHaveBeenCalledWith(request.requestId);
  });
});
