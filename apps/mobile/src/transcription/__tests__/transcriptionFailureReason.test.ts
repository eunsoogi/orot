import { createTranscriptEvidenceService } from '../transcriptEvidenceService';
import { TranscriptRecognitionError } from '../TranscriptRecognitionError';
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
