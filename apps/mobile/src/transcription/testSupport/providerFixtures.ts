import type { TranscriptionRequest } from '@orot/model-runtime';
import {
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
  recordingRequests: Array<{
    recordingId: string;
    language: string;
    syntheticFixture?: boolean;
  }> = [];

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
    return this.response;
  }

  async transcribeRecording(request: {
    recordingId: string;
    language: string;
    syntheticFixture?: boolean;
  }): Promise<NativeSpeechTranscriptionResponse> {
    this.recordingRequests.push(request);
    if (this.error) throw this.error;
    return this.response;
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
