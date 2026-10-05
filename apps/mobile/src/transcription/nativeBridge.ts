import { NativeModules } from 'react-native';
import type {
  NativeSpeechTranscriptionBridge,
  NativeSpeechTranscriptionRequest,
  NativeSpeechTranscriptionResponse,
  SpeechAvailability,
} from './types';

interface NativeSpeechModule {
  getAvailability(language: string): Promise<SpeechAvailability>;
  transcribeAudio(
    request: NativeSpeechTranscriptionRequest,
  ): Promise<NativeSpeechTranscriptionResponse>;
}

function requireNativeModule(): NativeSpeechModule {
  const module = NativeModules.SpeechTranscriptionModule as
    NativeSpeechModule | undefined;
  if (!module) {
    // A missing build registration must surface distinctly instead of looking like unsupported hardware.
    const error = new Error(
      'The Apple speech transcription native module is unavailable.',
    ) as Error & {
      code?: string;
    };
    error.code = 'NATIVE_MODULE_UNAVAILABLE';
    throw error;
  }
  return module;
}

export const appleSpeechTranscriptionNativeBridge: NativeSpeechTranscriptionBridge =
  {
    getAvailability(language) {
      return requireNativeModule().getAvailability(language);
    },

    transcribe(request) {
      return requireNativeModule().transcribeAudio(request);
    },
  };
