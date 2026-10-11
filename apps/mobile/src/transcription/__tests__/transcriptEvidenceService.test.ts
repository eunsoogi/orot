import { providerSuccess } from '@orot/model-runtime';
import { createTranscriptEvidenceService } from '../transcriptEvidenceService';
import {
  makeRepository,
  original,
  source,
} from '../testSupport/transcriptEvidenceServiceFixtures';

jest.mock('../index', () => ({
  appleOnDeviceSpeechTranscriptionProvider: { transcribeRecording: jest.fn() },
}));

describe('transcript evidence service', () => {
  it('stores millisecond audio ranges and engine provenance, then seeks the same range', async () => {
    const { repository, transcripts } = makeRepository();
    const response = {
      text: original.text,
      language: 'ko-KR',
      segments: [
        { text: original.text, startSeconds: 0.2501, endSeconds: 1.8001 },
      ],
      engine: 'dictation_transcriber' as const,
      runtimeVersion: 'iOS 26.2 (23C54)',
      recordingDurationMs: 5000,
    };
    const provider = {
      transcribeRecording: jest.fn(async () => providerSuccess(response)),
    };
    const playRange = jest.fn(
      async (_id: string, startMs: number, endMs: number) => ({
        startMs,
        endMs,
        actualStartMs: startMs,
      }),
    );
    const service = createTranscriptEvidenceService({
      loadRepository: async () => repository,
      provider,
      playRange,
      now: () => new Date('2026-10-05T10:00:06.000Z'),
    });

    const stored = await service.transcribe(source.id);
    expect(provider.transcribeRecording).toHaveBeenCalledWith({
      recordingId: source.id,
      language: 'ko-KR',
    });
    expect(transcripts.append).toHaveBeenCalledWith([
      expect.objectContaining({
        recordingSourceId: source.id,
        audioRange: { startMs: 250, endMs: 1801 },
        reviewState: { status: 'unreviewed' },
        provenance: {
          origin: 'derived',
          sourceRecordIds: [source.id],
          source: expect.objectContaining({
            sourceIdentifier: 'dictation_transcriber',
            sourceVersion: 'iOS 26.2 (23C54)',
          }),
        },
      }),
    ]);
    await service.play(stored[0]);
    expect(playRange).toHaveBeenCalledWith(source.id, 250, 1801);
  });

  it('forwards caller cancellation to the provider for a saved recording', async () => {
    const { repository } = makeRepository();
    const controller = new AbortController();
    const provider = {
      transcribeRecording: jest.fn(async () =>
        providerSuccess({
          text: original.text,
          language: 'ko-KR',
          segments: [
            { text: original.text, startSeconds: 0.25, endSeconds: 1.8 },
          ],
          engine: 'dictation_transcriber' as const,
          runtimeVersion: 'iOS 26.2 (23C54)',
          recordingDurationMs: 5000,
        }),
      ),
    };
    const service = createTranscriptEvidenceService({
      loadRepository: async () => repository,
      provider,
    });

    // Saved recordings must carry user cancellation through the service boundary to the native provider.
    await service.transcribe(source.id, controller.signal);

    expect(provider.transcribeRecording).toHaveBeenCalledWith({
      recordingId: source.id,
      language: 'ko-KR',
      signal: controller.signal,
    });
  });

  it('loads stale derived artifacts with their recording-linked transcript revisions', async () => {
    const { repository, transcripts } = makeRepository([original]);
    const service = createTranscriptEvidenceService({
      loadRepository: async () => repository,
    });

    await expect(service.load(source.id)).resolves.toEqual({
      source,
      segments: [original],
      staleArtifacts: [
        expect.objectContaining({ kind: 'visit_question', id: 'question-1' }),
      ],
    });
    expect(transcripts.listStaleArtifacts).toHaveBeenCalledWith(
      original.transcriptId,
    );
  });
});
