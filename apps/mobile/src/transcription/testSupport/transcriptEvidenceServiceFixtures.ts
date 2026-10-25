import type { SourceRecord, TranscriptEvidenceSegment } from '@orot/domain';
import type { RecordRepository, StaleTranscriptArtifact } from '@orot/storage';

export const source: SourceRecord = {
  id: 'recording-1',
  sourceKind: 'audio_recording',
  effectiveAt: '2026-10-05T10:00:00.000Z',
  recordedAt: '2026-10-05T10:00:05.000Z',
  ingestedAt: '2026-10-05T10:00:06.000Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  title: '상담 녹음',
};

export const original: TranscriptEvidenceSegment = {
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

export function makeRepository(
  initialSegments: TranscriptEvidenceSegment[] = [],
) {
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
