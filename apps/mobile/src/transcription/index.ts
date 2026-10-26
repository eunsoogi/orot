import { appleSpeechTranscriptionNativeBridge } from './nativeBridge';
import { AppleOnDeviceSpeechProvider } from './provider';

// Keep product callers on one stable provider entry while exposing the native bridge for focused probes.
export {
  AppleOnDeviceSpeechProvider,
  ON_DEVICE_SPEECH_CAPABILITIES,
  ON_DEVICE_SPEECH_PROVIDER_ID,
} from './provider';
export { appleSpeechTranscriptionNativeBridge } from './nativeBridge';
export type {
  NativeSpeechTranscriptionBridge,
  NativeRecordingTranscriptionRequest,
  NativeSpeechTranscriptionRequest,
  NativeSpeechTranscriptionResponse,
  TranscriptionRecordingRequest,
  SpeechAvailability,
  SpeechAvailabilityStatus,
  SpeechRecognitionEngine,
} from './types';

export const appleOnDeviceSpeechTranscriptionProvider =
  new AppleOnDeviceSpeechProvider(appleSpeechTranscriptionNativeBridge);
