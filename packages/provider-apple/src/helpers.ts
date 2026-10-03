import type {
  LanguageModelInputPart,
  LanguageModelRequest,
  ProviderError,
} from '@orot/model-runtime';
import type { AppleAvailabilityStatus } from './types';

export function validateRequest(request: LanguageModelRequest): ProviderError | undefined {
  if (!request || !Array.isArray(request.messages) || request.messages.length === 0) {
    return { code: 'invalid_request', message: 'At least one message is required.', retryable: false };
  }
  const unsupported = request.messages.some((message) => {
    if (message.role === 'tool' || typeof message.content === 'string') return false;
    return (message.content as readonly LanguageModelInputPart[]).some((part) => part.type !== 'text');
  });
  return unsupported
    ? { code: 'unsupported_input', message: 'Apple Foundation Models accepts text input only.', retryable: false }
    : undefined;
}

export function unavailableFailure(status: AppleAvailabilityStatus): ProviderError {
  return {
    code: 'provider_unavailable',
    message: 'Apple Foundation Models is unavailable: ' + status,
    retryable: status === 'modelNotReady',
  };
}

export function nativeFailure(error: unknown): ProviderError {
  const value = error as {
    code?: unknown;
    message?: unknown;
    status?: unknown;
    userInfo?: { status?: unknown };
  };
  const code = typeof value?.code === 'string' ? value.code : '';
  const message = typeof value?.message === 'string' ? value.message : 'Apple model request failed.';
  const status = value?.status ?? value?.userInfo?.status;
  if (code === 'APPLE_MODEL_UNAVAILABLE' && isAvailabilityStatus(status)) {
    return unavailableFailure(status);
  }
  if (code === 'UNSUPPORTED_INPUT') return { code: 'unsupported_input', message, retryable: false };
  if (code === 'UNSUPPORTED_CAPABILITY') return { code: 'unsupported_capability', message, retryable: false };
  if (code === 'INVALID_REQUEST') return { code: 'invalid_request', message, retryable: false };
  return { code: 'internal_error', message, retryable: false };
}

export function abortError(): Error {
  const error = new Error('Apple Foundation Models request was cancelled.');
  error.name = 'AbortError';
  return error;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function isAvailabilityStatus(value: unknown): value is AppleAvailabilityStatus {
  return value === 'available'
    || value === 'disabled'
    || value === 'modelNotReady'
    || value === 'unsupportedDevice'
    || value === 'unsupportedLanguage';
}
