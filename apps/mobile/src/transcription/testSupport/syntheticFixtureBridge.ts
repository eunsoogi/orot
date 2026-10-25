import type { NativeSpeechTranscriptionBridge } from '../types';

export function createSyntheticFixtureNativeBridge(
  native: NativeSpeechTranscriptionBridge,
  syntheticFixture: boolean,
): NativeSpeechTranscriptionBridge {
  return {
    getAvailability(language) {
      return native.getAvailability(language);
    },
    transcribe(request) {
      const markedRequest = { ...request, syntheticFixture };
      return native.transcribe(markedRequest);
    },
    cancelTranscription(requestId) {
      // The provider's abort and deadline must stop the native request, not only its JavaScript waiter.
      native.cancelTranscription?.(requestId);
    },
  };
}
