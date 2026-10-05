import {
  providerFailure,
  providerSuccess,
  type ProviderResult,
  type TranscriptionCapabilities,
  type TranscriptionProvider,
  type TranscriptionRequest,
} from '@orot/model-runtime';
import { encodeAudioBase64 } from './base64';
import { validateNativeTranscriptionResponse } from './responseValidation';
import type {
  NativeRecordingTranscriptionRequest,
  NativeSpeechTranscriptionBridge,
  NativeSpeechTranscriptionResponse,
  SpeechAvailability,
} from './types';
import {
  AVAILABILITY_ERRORS,
  nativeError,
  normalizeLanguage,
  normalizeMediaType,
  validateAudioRequest,
} from './providerErrors';

export const ON_DEVICE_SPEECH_PROVIDER_ID = 'apple-on-device-speech';

export const ON_DEVICE_SPEECH_CAPABILITIES: TranscriptionCapabilities = {
  inputTypes: ['audio'],
  streaming: false,
};

export class AppleOnDeviceSpeechProvider implements TranscriptionProvider {
  readonly kind = 'transcription' as const;
  readonly id = ON_DEVICE_SPEECH_PROVIDER_ID;
  readonly displayName = 'Apple on-device speech';
  readonly capabilities = ON_DEVICE_SPEECH_CAPABILITIES;

  constructor(private readonly native: NativeSpeechTranscriptionBridge) {}

  async getAvailability(language = 'ko-KR'): Promise<SpeechAvailability> {
    const normalizedLanguage = normalizeLanguage(language);
    if (!normalizedLanguage) {
      return {
        status: 'unsupported_language',
        engine: 'none',
        locale: language,
      };
    }
    return this.native.getAvailability(normalizedLanguage);
  }

  async transcribe(
    request: TranscriptionRequest,
  ): Promise<ProviderResult<NativeSpeechTranscriptionResponse>> {
    const language = normalizeLanguage(request?.language ?? 'ko-KR');
    if (!language)
      return providerFailure(AVAILABILITY_ERRORS.unsupported_language);
    const audioError = validateAudioRequest(request);
    if (audioError) return providerFailure(audioError);
    return this.withAvailableEngine(language, () =>
      this.native.transcribe({
        audioBase64: encodeAudioBase64(request.audio.data),
        mediaType: normalizeMediaType(request.audio.mediaType),
        language,
      }),
    );
  }

  async transcribeRecording(
    request: NativeRecordingTranscriptionRequest,
  ): Promise<ProviderResult<NativeSpeechTranscriptionResponse>> {
    const language = normalizeLanguage(request?.language ?? 'ko-KR');
    if (!language)
      return providerFailure(AVAILABILITY_ERRORS.unsupported_language);
    if (
      typeof request.recordingId !== 'string' ||
      request.recordingId.trim().length === 0
    ) {
      return providerFailure({
        code: 'invalid_request',
        message: 'INVALID_RECORDING: A saved recording identifier is required.',
        retryable: false,
      });
    }
    const transcribe = this.native.transcribeRecording;
    if (!transcribe) {
      return providerFailure(
        nativeError({ code: 'NATIVE_MODULE_UNAVAILABLE' }),
      );
    }
    return this.withAvailableEngine(language, () =>
      transcribe.call(this.native, {
        ...request,
        recordingId: request.recordingId.trim(),
        language,
      }),
    );
  }

  private async withAvailableEngine(
    language: string,
    operation: () => Promise<NativeSpeechTranscriptionResponse>,
  ): Promise<ProviderResult<NativeSpeechTranscriptionResponse>> {
    let availability: SpeechAvailability;
    try {
      availability = await this.native.getAvailability(language);
    } catch (error) {
      return providerFailure(nativeError(error));
    }
    if (
      availability.status !== 'available' &&
      availability.status !== 'permission_not_determined'
    ) {
      return providerFailure(AVAILABILITY_ERRORS[availability.status]);
    }
    try {
      // The legacy API may prompt only after a user-started transcription request.
      const nativeResponse = await operation();
      const validation = validateNativeTranscriptionResponse(nativeResponse);
      if (!validation.ok) {
        return providerFailure({
          code: 'internal_error',
          message: 'INVALID_TRANSCRIPTION_RESULT: ' + validation.message,
          retryable: false,
        });
      }
      return providerSuccess(validation.response);
    } catch (error) {
      return providerFailure(nativeError(error));
    }
  }
}
