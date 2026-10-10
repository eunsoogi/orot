import type { ProviderError } from '@orot/model-runtime';
import type { SpeechAvailabilityStatus } from './types';

export const AVAILABILITY_ERRORS: Record<
  Exclude<SpeechAvailabilityStatus, 'available' | 'permission_not_determined'>,
  ProviderError
> = {
  unsupported_language: {
    code: 'unsupported_capability',
    message:
      'UNSUPPORTED_LANGUAGE: Apple on-device speech does not support this language.',
    retryable: false,
  },
  unsupported_device: {
    code: 'unsupported_capability',
    message:
      'UNSUPPORTED_DEVICE: Apple on-device speech is unavailable on this device.',
    retryable: false,
  },
  model_unavailable: {
    code: 'provider_unavailable',
    message:
      'MODEL_UNAVAILABLE: The required on-device speech model is unavailable.',
    retryable: true,
  },
  permission_denied: {
    code: 'unsupported_capability',
    message: 'PERMISSION_DENIED: Speech recognition permission was denied.',
    retryable: false,
  },
  permission_restricted: {
    code: 'unsupported_capability',
    message:
      'PERMISSION_RESTRICTED: Speech recognition is restricted on this device.',
    retryable: false,
  },
  recognizer_unavailable: {
    code: 'provider_unavailable',
    message:
      'RECOGNIZER_UNAVAILABLE: Apple on-device speech is temporarily unavailable.',
    retryable: true,
  },
};

const SUPPORTED_MEDIA_TYPES = new Set([
  'audio/aac',
  'audio/caf',
  'audio/m4a',
  'audio/mp4',
  'audio/wav',
  'audio/x-caf',
  'audio/x-m4a',
  'audio/x-wav',
]);

export function normalizeLanguage(language: string): string | undefined {
  const normalized = language.trim().toLowerCase();
  if (!normalized || normalized.split('-')[0] !== 'ko') return undefined;
  return 'ko-KR';
}

export function normalizeMediaType(mediaType: string): string {
  return mediaType.split(';', 1)[0].trim().toLowerCase();
}

export function validateAudioRequest(request: {
  audio?: { data?: unknown; mediaType?: unknown };
}): ProviderError | undefined {
  const audio = request?.audio;
  if (!(audio?.data instanceof Uint8Array) || audio.data.length === 0) {
    return {
      code: 'invalid_request',
      message: 'INVALID_AUDIO: Audio data must be a non-empty Uint8Array.',
      retryable: false,
    };
  }
  if (
    typeof audio.mediaType !== 'string' ||
    !SUPPORTED_MEDIA_TYPES.has(normalizeMediaType(audio.mediaType))
  ) {
    return {
      code: 'unsupported_input',
      message:
        'UNSUPPORTED_MEDIA_TYPE: Apple on-device speech cannot read this audio format.',
      retryable: false,
    };
  }
}

export function nativeError(error: unknown): ProviderError {
  const native = error as { code?: unknown; message?: unknown } | null;
  const code =
    typeof native?.code === 'string'
      ? native.code
      : 'SPEECH_RECOGNITION_FAILED';
  const detail =
    typeof native?.message === 'string'
      ? native.message
      : 'Apple on-device speech failed.';
  if (code === 'UNSUPPORTED_LANGUAGE')
    return AVAILABILITY_ERRORS.unsupported_language;
  if (code === 'UNSUPPORTED_DEVICE')
    return AVAILABILITY_ERRORS.unsupported_device;
  if (code === 'MODEL_UNAVAILABLE' || code === 'MODEL_INSTALL_FAILED') {
    return {
      ...AVAILABILITY_ERRORS.model_unavailable,
      message: 'MODEL_UNAVAILABLE: ' + detail,
    };
  }
  if (code === 'PERMISSION_DENIED')
    return AVAILABILITY_ERRORS.permission_denied;
  if (code === 'PERMISSION_RESTRICTED')
    return AVAILABILITY_ERRORS.permission_restricted;
  if (code === 'PERMISSION_NOT_DETERMINED') {
    return {
      code: 'unsupported_capability',
      message:
        'PERMISSION_NOT_DETERMINED: Speech recognition permission was not granted.',
      retryable: false,
    };
  }
  if (code === 'RECOGNIZER_UNAVAILABLE')
    return AVAILABILITY_ERRORS.recognizer_unavailable;
  if (code === 'NATIVE_MODULE_UNAVAILABLE') {
    return {
      code: 'provider_unavailable',
      message:
        'NATIVE_MODULE_UNAVAILABLE: The Apple speech module is not registered in this app build.',
      retryable: false,
    };
  }
  if (code === 'TRANSCRIPTION_CANCELLED') {
    return {
      code: 'provider_unavailable',
      message: 'TRANSCRIPTION_CANCELLED: ' + detail,
      retryable: false,
    };
  }
  if (code === 'TRANSCRIPTION_TIMEOUT') {
    return {
      code: 'provider_unavailable',
      message: 'TRANSCRIPTION_TIMEOUT: ' + detail,
      retryable: true,
    };
  }
  if (code === 'INVALID_AUDIO') {
    return {
      code: 'invalid_request',
      message: 'INVALID_AUDIO: ' + detail,
      retryable: false,
    };
  }
  if (code === 'UNSUPPORTED_MEDIA_TYPE') {
    return {
      code: 'unsupported_input',
      message: 'UNSUPPORTED_MEDIA_TYPE: ' + detail,
      retryable: false,
    };
  }
  if (code === 'INVALID_TIMESTAMP' || code === 'INVALID_TRANSCRIPTION_RESULT') {
    return {
      code: 'internal_error',
      message: code + ': ' + detail,
      retryable: false,
    };
  }
  return {
    code: 'provider_unavailable',
    message: code + ': ' + detail,
    retryable: true,
  };
}
