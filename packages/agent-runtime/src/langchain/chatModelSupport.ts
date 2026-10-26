import type { BaseChatModelCallOptions } from '@langchain/core/language_models/chat_models';
import type { ProviderError, ProviderErrorCode, StructuredOutputFormat } from '@orot/model-runtime';

export interface NativeChatModelCallOptions extends BaseChatModelCallOptions {
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
  readonly responseFormat?: StructuredOutputFormat;
  /** Per-call privacy opt-in; the adapter consumes this flag before provider dispatch. */
  readonly externalTelemetryEnabled?: boolean;
}

/** Preserve the provider's closed error classification without exposing its diagnostic payload. */
export class NativeChatModelError extends Error {
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  constructor(error: ProviderError) {
    super(`Native model invocation failed (${error.code}).`);
    this.name = 'NativeChatModelError';
    this.code = error.code;
    this.retryable = error.retryable;
  }
}

/** Reject unsupported model controls with the same closed provider error shape. */
export function unsupportedNativeCallOption(): never {
  throw new NativeChatModelError({
    code: 'unsupported_capability',
    message: 'The invocation adapter does not support this option.',
    retryable: false,
  });
}
