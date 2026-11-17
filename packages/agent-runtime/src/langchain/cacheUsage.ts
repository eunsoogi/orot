import type { LanguageModelResponse } from '@orot/model-runtime';

/** Cache reads are optional reported telemetry, never evidence of server session continuity. */
export function cachedTokenDetails(usage: NonNullable<LanguageModelResponse['usage']>) {
  const count = usage.cachedInputTokens;
  return typeof count === 'number' &&
    Number.isSafeInteger(count) &&
    count >= 0 &&
    count <= usage.inputTokens
    ? { input_token_details: { cache_read: count } }
    : {};
}
