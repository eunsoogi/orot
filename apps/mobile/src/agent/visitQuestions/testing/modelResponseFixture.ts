import type { LanguageModelResponse } from '@orot/model-runtime';

/** Test providers return actual protocol tool calls, not JSON text pretending to execute a search. */
export function modelResponseFixture(text: string): LanguageModelResponse {
  try {
    const value = JSON.parse(text);
    if (Array.isArray(value.toolCalls)) return value as LanguageModelResponse;
  } catch {
    // Malformed output is deliberately passed through to exercise runtime validation.
  }
  return { text, toolCalls: [], finishReason: 'complete' };
}
