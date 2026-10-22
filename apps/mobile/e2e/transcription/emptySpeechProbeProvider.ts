import { providerSuccess } from '@orot/model-runtime';
import { appleOnDeviceSpeechTranscriptionProvider } from '../../src/transcription';
import type { AppleOnDeviceSpeechProvider } from '../../src/transcription/provider';

/** Test-entry-only empty result exercises production recovery without microphone or Speech access. */
export function automaticProbeProvider(
  emptySpeech: boolean,
): Pick<AppleOnDeviceSpeechProvider, 'transcribeRecording'> {
  if (!emptySpeech) return appleOnDeviceSpeechTranscriptionProvider;
  return {
    async transcribeRecording() {
      return providerSuccess({
        text: '',
        segments: [],
        engine: 'dictation_transcriber',
        runtimeVersion: 'synthetic-empty-result',
        recordingDurationMs: 1,
      });
    },
  };
}
