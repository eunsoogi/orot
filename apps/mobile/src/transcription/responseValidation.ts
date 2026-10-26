import type { NativeSpeechTranscriptionResponse } from './types';

export type ResponseValidation =
  | { readonly ok: true; readonly response: NativeSpeechTranscriptionResponse }
  | { readonly ok: false; readonly message: string };

// Reject broken native time ranges instead of returning evidence links that point at the wrong audio.
export function validateNativeTranscriptionResponse(
  value: unknown,
): ResponseValidation {
  if (!value || typeof value !== 'object') {
    return {
      ok: false,
      message: 'The native speech module returned no transcription.',
    };
  }

  const response = value as Record<string, unknown>;
  if (typeof response.text !== 'string' || !Array.isArray(response.segments)) {
    return {
      ok: false,
      message: 'The native speech module returned an incomplete transcription.',
    };
  }
  if (
    response.language !== undefined &&
    typeof response.language !== 'string'
  ) {
    return {
      ok: false,
      message: 'The native speech module returned an invalid language.',
    };
  }
  if (
    response.engine !== 'speech_transcriber' &&
    response.engine !== 'dictation_transcriber' &&
    response.engine !== 'on_device_speech_recognizer'
  ) {
    return {
      ok: false,
      message: 'The native speech module returned no selected engine.',
    };
  }
  if (
    typeof response.runtimeVersion !== 'string' ||
    response.runtimeVersion.trim().length === 0
  ) {
    return {
      ok: false,
      message: 'The native speech module returned no runtime version.',
    };
  }
  if (
    typeof response.recordingDurationMs !== 'number' ||
    !Number.isSafeInteger(response.recordingDurationMs) ||
    response.recordingDurationMs <= 0
  ) {
    return {
      ok: false,
      message: 'The native speech module returned an invalid audio duration.',
    };
  }

  let previousStart = -1;
  for (const candidate of response.segments) {
    if (!candidate || typeof candidate !== 'object') {
      return {
        ok: false,
        message: 'The native speech module returned an invalid segment.',
      };
    }
    const segment = candidate as Record<string, unknown>;
    if (typeof segment.text !== 'string' || segment.text.trim().length === 0) {
      return { ok: false, message: 'A transcript segment must contain text.' };
    }
    if (
      typeof segment.startSeconds !== 'number' ||
      !Number.isFinite(segment.startSeconds) ||
      typeof segment.endSeconds !== 'number' ||
      !Number.isFinite(segment.endSeconds) ||
      segment.startSeconds < 0 ||
      segment.endSeconds <= segment.startSeconds ||
      segment.endSeconds > response.recordingDurationMs / 1000 + 0.1 ||
      segment.startSeconds < previousStart
    ) {
      return {
        ok: false,
        message:
          'Transcript segment timestamps must be finite, positive, and ordered.',
      };
    }
    previousStart = segment.startSeconds;
  }

  return {
    ok: true,
    response: {
      text: response.text,
      language: response.language as string | undefined,
      segments:
        response.segments as NativeSpeechTranscriptionResponse['segments'],
      engine: response.engine as NativeSpeechTranscriptionResponse['engine'],
      runtimeVersion: response.runtimeVersion,
      recordingDurationMs: response.recordingDurationMs,
    },
  };
}
