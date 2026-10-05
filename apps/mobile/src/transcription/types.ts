import type { TranscriptionResponse } from '@orot/model-runtime';

// This bridge shape preserves native availability reasons and audio-relative segments across the React Native boundary.
export type SpeechRecognitionEngine =
  | 'speech_transcriber'
  | 'dictation_transcriber'
  | 'on_device_speech_recognizer'
  | 'none';

export type SpeechAvailabilityStatus =
  | 'available'
  | 'unsupported_language'
  | 'unsupported_device'
  | 'model_unavailable'
  | 'permission_not_determined'
  | 'permission_denied'
  | 'permission_restricted'
  | 'recognizer_unavailable';

export interface SpeechAvailability {
  readonly status: SpeechAvailabilityStatus;
  readonly engine: SpeechRecognitionEngine;
  readonly locale: string;
  readonly modelInstalled?: boolean;
}

export interface NativeSpeechTranscriptionRequest {
  readonly audioBase64: string;
  readonly mediaType: string;
  readonly language: string;
}

export interface NativeRecordingTranscriptionRequest {
  readonly recordingId: string;
  readonly language: string;
  readonly syntheticFixture?: boolean;
}

export interface NativeSpeechTranscriptionResponse extends TranscriptionResponse {
  readonly engine: Exclude<SpeechRecognitionEngine, 'none'>;
  readonly runtimeVersion: string;
  readonly recordingDurationMs: number;
}

export interface NativeSpeechTranscriptionBridge {
  getAvailability(language: string): Promise<SpeechAvailability>;
  transcribe(
    request: NativeSpeechTranscriptionRequest,
  ): Promise<NativeSpeechTranscriptionResponse>;
  transcribeRecording?(
    request: NativeRecordingTranscriptionRequest,
  ): Promise<NativeSpeechTranscriptionResponse>;
}
