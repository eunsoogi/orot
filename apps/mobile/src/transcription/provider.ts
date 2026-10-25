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
  NativeSpeechTranscriptionBridge,
  NativeSpeechTranscriptionResponse,
  SpeechAvailability,
  TranscriptionRecordingRequest,
} from './types';
import {
  AVAILABILITY_ERRORS,
  nativeError,
  normalizeLanguage,
  normalizeMediaType,
  validateAudioRequest,
} from './providerErrors';

export const ON_DEVICE_SPEECH_PROVIDER_ID = 'apple-on-device-speech';

const SPEECH_TRANSCRIPTION_TIMEOUT_MS = 120_000;
let nextRequestSequence = 0;

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
    return this.withNativeRequest(request.signal, requestId =>
      this.native.transcribe({
        requestId,
        audioBase64: encodeAudioBase64(request.audio.data),
        mediaType: normalizeMediaType(request.audio.mediaType),
        language,
      }),
    );
  }

  async transcribeRecording(
    request: TranscriptionRecordingRequest,
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
    return this.withNativeRequest(request.signal, requestId =>
      transcribe.call(this.native, {
        requestId,
        recordingId: request.recordingId.trim(),
        language,
        ...(request.syntheticFixture ? { syntheticFixture: true } : {}),
      }),
    );
  }

  private async withNativeRequest(
    signal: AbortSignal | undefined,
    operation: (
      requestId: string,
    ) => Promise<NativeSpeechTranscriptionResponse>,
  ): Promise<ProviderResult<NativeSpeechTranscriptionResponse>> {
    const requestId = createRequestId();
    try {
      const nativeResponse = await waitForNativeRequest(
        signal,
        requestId,
        this.native,
        () => operation(requestId),
      );
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

function createRequestId(): string {
  nextRequestSequence = (nextRequestSequence + 1) % Number.MAX_SAFE_INTEGER;
  return `speech-transcription-${Date.now().toString(36)}-${nextRequestSequence.toString(36)}`;
}

// The JS deadline returns promptly even when a native promise stops responding; native code enforces the same limit independently.
function waitForNativeRequest(
  signal: AbortSignal | undefined,
  requestId: string,
  native: NativeSpeechTranscriptionBridge,
  operation: () => Promise<NativeSpeechTranscriptionResponse>,
): Promise<NativeSpeechTranscriptionResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const finish = (
      result:
        | {
            readonly ok: true;
            readonly value: NativeSpeechTranscriptionResponse;
          }
        | { readonly ok: false; readonly error: unknown },
    ) => {
      if (settled) return;
      settled = true;
      if (timeout !== undefined) clearTimeout(timeout);
      signal?.removeEventListener('abort', cancel);
      if (result.ok) resolve(result.value);
      else reject(result.error);
    };

    const cancelNative = () => {
      try {
        native.cancelTranscription?.(requestId);
      } catch {
        // The request still returns a terminal cancellation or timeout result if the native bridge is already gone.
      }
    };

    const cancel = () => {
      cancelNative();
      finish({ ok: false, error: requestError('TRANSCRIPTION_CANCELLED') });
    };

    if (signal?.aborted) {
      finish({ ok: false, error: requestError('TRANSCRIPTION_CANCELLED') });
      return;
    }

    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) {
      finish({ ok: false, error: requestError('TRANSCRIPTION_CANCELLED') });
      return;
    }

    timeout = setTimeout(() => {
      cancelNative();
      finish({ ok: false, error: requestError('TRANSCRIPTION_TIMEOUT') });
    }, SPEECH_TRANSCRIPTION_TIMEOUT_MS);

    try {
      operation().then(
        value => finish({ ok: true, value }),
        error => finish({ ok: false, error }),
      );
    } catch (error) {
      finish({ ok: false, error });
    }
  });
}

function requestError(
  code: 'TRANSCRIPTION_CANCELLED' | 'TRANSCRIPTION_TIMEOUT',
) {
  const error = new Error(
    code === 'TRANSCRIPTION_CANCELLED'
      ? 'The speech transcription request was cancelled.'
      : 'The speech transcription request exceeded its time limit.',
  ) as Error & { code: string };
  error.code = code;
  return error;
}
