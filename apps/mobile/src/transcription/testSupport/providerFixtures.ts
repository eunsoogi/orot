import type { TranscriptionRequest } from '@orot/model-runtime';
import {
  type NativeRecordingTranscriptionRequest,
  type NativeSpeechTranscriptionBridge,
  type NativeSpeechTranscriptionRequest,
  type NativeSpeechTranscriptionResponse,
  type SpeechAvailability,
  type SpeechAvailabilityStatus,
} from '../index';

export const transcript: NativeSpeechTranscriptionResponse = {
  text: '가상 약품 500밀리그램을 복용하지 않았어요.',
  language: 'ko-KR',
  segments: [
    { startSeconds: 0.2, endSeconds: 1.3, text: '가상 약품 500밀리그램을' },
    { startSeconds: 1.4, endSeconds: 2.8, text: '복용하지 않았어요.' },
  ],
  engine: 'speech_transcriber',
  runtimeVersion: 'Version 26.2 (Build 23C54)',
  recordingDurationMs: 5000,
};

// Deterministic native boundary used only by provider contract tests.
export class FakeNativeSpeechBridge implements NativeSpeechTranscriptionBridge {
  status: SpeechAvailabilityStatus = 'available';
  engine: SpeechAvailability['engine'] = 'speech_transcriber';
  response: NativeSpeechTranscriptionResponse = transcript;
  error?: Error & { code?: string };
  availabilityCalls: string[] = [];
  requests: NativeSpeechTranscriptionRequest[] = [];
  cancelledRequests: string[] = [];
  recordingRequests: NativeRecordingTranscriptionRequest[] = [];

  async getAvailability(language: string): Promise<SpeechAvailability> {
    this.availabilityCalls.push(language);
    return {
      status: this.status,
      engine: this.engine,
      locale: language,
      modelInstalled: true,
    };
  }

  async transcribe(
    nativeRequest: NativeSpeechTranscriptionRequest,
  ): Promise<NativeSpeechTranscriptionResponse> {
    this.requests.push(nativeRequest);
    if (this.error) throw this.error;
    const statusErrorCodes: Partial<Record<SpeechAvailabilityStatus, string>> =
      {
        unsupported_language: 'UNSUPPORTED_LANGUAGE',
        unsupported_device: 'UNSUPPORTED_DEVICE',
        model_unavailable: 'MODEL_UNAVAILABLE',
        permission_denied: 'PERMISSION_DENIED',
        permission_restricted: 'PERMISSION_RESTRICTED',
        recognizer_unavailable: 'RECOGNIZER_UNAVAILABLE',
      };
    const code = statusErrorCodes[this.status];
    if (code) {
      const failure = new Error(
        `The native speech engine reported ${this.status}.`,
      ) as Error & {
        code: string;
      };
      failure.code = code;
      throw failure;
    }
    return this.response;
  }

  async transcribeRecording(
    request: NativeRecordingTranscriptionRequest,
  ): Promise<NativeSpeechTranscriptionResponse> {
    this.recordingRequests.push(request);
    if (this.error) throw this.error;
    return this.response;
  }

  cancelTranscription(requestId: string): void {
    this.cancelledRequests.push(requestId);
  }
}

export function transcriptionRequest(
  overrides: Partial<TranscriptionRequest> = {},
): TranscriptionRequest {
  return {
    audio: { data: Uint8Array.from([77, 97, 110]), mediaType: 'audio/mp4' },
    ...overrides,
  };
}
