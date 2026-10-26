import { createTranscriptEvidenceService } from '../transcriptEvidenceService';
import { TranscriptRecognitionError } from '../TranscriptRecognitionError';
import { providerSuccess } from '@orot/model-runtime';
import {
  errorLabel,
  transcriptionCreationError,
} from '../transcriptReviewPresentation';
import {
  makeRepository,
  source,
} from '../testSupport/transcriptEvidenceServiceFixtures';

jest.mock('../index', () => ({ appleOnDeviceSpeechTranscriptionProvider: {} }));

test('preserves the native failure classification without writing transcript evidence', async () => {
  const { repository, transcripts } = makeRepository();
  const error = {
    code: 'unsupported_capability' as const,
    message: 'PERMISSION_DENIED: Speech permission denied.',
    retryable: false,
  };
  const service = createTranscriptEvidenceService({
    loadRepository: async () => repository,
    provider: {
      transcribeRecording: async () => ({ ok: false as const, error }),
    },
  });
  await expect(service.transcribe(source.id)).rejects.toMatchObject({
    reason: 'PERMISSION_DENIED',
    providerError: error,
  });
  await expect(service.transcribe(source.id)).rejects.toBeInstanceOf(
    TranscriptRecognitionError,
  );
  expect(transcripts.append).not.toHaveBeenCalled();
});

test('explains an empty recognition result without diagnosing device support or storing evidence', async () => {
  const { repository, transcripts } = makeRepository();
  const service = createTranscriptEvidenceService({
    loadRepository: async () => repository,
    provider: {
      transcribeRecording: async () =>
        providerSuccess({
          text: '',
          segments: [],
          language: 'ko-KR',
          engine: 'dictation_transcriber',
          runtimeVersion: 'test-runtime',
          recordingDurationMs: 5000,
        }),
    },
  });
  const failure = await service.transcribe(source.id).catch(error => error);
  expect(failure).toBeInstanceOf(TranscriptRecognitionError);
  expect(failure).toMatchObject({ reason: 'NO_RECOGNIZED_SPEECH' });
  expect(errorLabel(transcriptionCreationError(failure))).toBe(
    '인식된 말이 없어요. 녹음을 들어 소리가 담겼는지 확인한 뒤 다시 시도해 주세요.',
  );
  expect(transcripts.append).not.toHaveBeenCalled();
  // Empty recognition leaves the saved source available; it must not create fabricated transcript evidence.
  await expect(repository.get('source_record', source.id)).resolves.toEqual(
    source,
  );
});
