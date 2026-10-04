import type { TranscriptionResponse } from '@orot/model-runtime';

export type ResponseValidation =
  | { readonly ok: true; readonly response: TranscriptionResponse }
  | { readonly ok: false; readonly message: string };

// Reject broken native time ranges instead of returning evidence links that point at the wrong audio.
export function validateNativeTranscriptionResponse(
  value: unknown,
): ResponseValidation {
  if (!value || typeof value !== 'object') {
    return { ok: false, message: 'The native speech module returned no transcription.' };
  }

  const response = value as Record<string, unknown>;
  if (typeof response.text !== 'string' || !Array.isArray(response.segments)) {
    return { ok: false, message: 'The native speech module returned an incomplete transcription.' };
  }
  if (response.language !== undefined && typeof response.language !== 'string') {
    return { ok: false, message: 'The native speech module returned an invalid language.' };
  }

  let previousStart = -1;
  for (const candidate of response.segments) {
    if (!candidate || typeof candidate !== 'object') {
      return { ok: false, message: 'The native speech module returned an invalid segment.' };
    }
    const segment = candidate as Record<string, unknown>;
    if (typeof segment.text !== 'string' || segment.text.trim().length === 0) {
      return { ok: false, message: 'A transcript segment must contain text.' };
    }
    if (
      typeof segment.startSeconds !== 'number'
      || !Number.isFinite(segment.startSeconds)
      || typeof segment.endSeconds !== 'number'
      || !Number.isFinite(segment.endSeconds)
      || segment.startSeconds < 0
      || segment.endSeconds <= segment.startSeconds
      || segment.startSeconds < previousStart
    ) {
      return { ok: false, message: 'Transcript segment timestamps must be finite, positive, and ordered.' };
    }
    previousStart = segment.startSeconds;
  }

  return {
    ok: true,
    response: {
      text: response.text,
      language: response.language as string | undefined,
      segments: response.segments as TranscriptionResponse['segments'],
    },
  };
}
