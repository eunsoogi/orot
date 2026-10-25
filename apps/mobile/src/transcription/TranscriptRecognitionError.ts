import type { ProviderError } from '@orot/model-runtime';

/** Keep the provider's classification while exposing only a safe reason key to UI. */
export class TranscriptRecognitionError extends Error {
  readonly reason: string;
  constructor(readonly providerError: ProviderError) {
    super(providerError.message);
    this.name = 'TranscriptRecognitionError';
    this.reason = providerError.message.split(':', 1)[0];
  }
}
