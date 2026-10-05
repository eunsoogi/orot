import { providerSuccess } from '@orot/model-runtime';
import type { SourceRecord, TranscriptEvidenceSegment } from '@orot/domain';
import type { RecordRepository, StaleTranscriptArtifact } from '@orot/storage';
import { createTranscriptEvidenceService } from '../transcriptEvidenceService';

jest.mock('../index', () => ({
  appleOnDeviceSpeechTranscriptionProvider: { transcribeRecording: jest.fn() },
}));

const source: SourceRecord = {
  id: 'recording-1',
  sourceKind: 'audio_recording',
  effectiveAt: '2026-10-05T10:00:00.000Z',
  recordedAt: '2026-10-05T10:00:05.000Z',
  ingestedAt: '2026-10-05T10:00:06.000Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  title: '상담 녹음',
};

const original: TranscriptEvidenceSegment = {
  id: 'recording-1:segment:0:r1',
  transcriptId: 'recording-1:segment:0',
  recordingSourceId: source.id,
  segmentOrdinal: 0,
  revision: 1,
  text: '복용하지 않았어요.',
  language: 'ko-KR',
  recordingDurationMs: 5000,
  audioRange: { startMs: 250, endMs: 1801 },
  effectiveAt: '2026-10-05T10:00:00.250Z',
  recordedAt: '2026-10-05T10:00:06.000Z',
  ingestedAt: '2026-10-05T10:00:06.000Z',
  provenance: {
    origin: 'derived',
    sourceRecordIds: [source.id],
    source: {
      system: 'Apple Speech',
      sourceIdentifier: 'dictation_transcriber',
      sourceVersion: 'iOS 26.2 (23C54)',
    },
  },
  reviewState: { status: 'unreviewed' },
};

function makeRepository(initialSegments: TranscriptEvidenceSegment[] = []) {
  let segments = initialSegments;
  const staleArtifact: StaleTranscriptArtifact = {
    kind: 'visit_question',
    id: 'question-1',
    supersededSegmentId: original.id,
    currentSegmentId: 'recording-1:segment:0:r2',
    invalidatedAt: '2026-10-05T10:02:00.000Z',
  };
  const transcripts = {
    append: jest.fn(async (next: readonly TranscriptEvidenceSegment[]) => {
      segments = [...next];
    }),
    listForRecording: jest.fn(async () => segments),
    correct: jest.fn(),
    listStaleArtifacts: jest.fn(async () => [staleArtifact]),
  };
  const repository = {
    get: jest.fn(async () => source),
    list: jest.fn(async () => [source]),
    transcripts,
  } as unknown as RecordRepository;
  return { repository, transcripts };
}

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
