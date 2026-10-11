import type { RecordRepository } from '@orot/storage';
import type { SourceRecord, TranscriptEvidenceSegment } from '@orot/domain';
import {
  createRecordingLibraryService,
  type RecordingAudioDeletion,
} from '../recordingLibraryService';

const source = (id: string, recordingDurationMs?: number): SourceRecord => ({
  id,
  sourceKind: 'audio_recording',
  effectiveAt: '2026-10-05T10:00:00.000Z',
  recordedAt: '2026-10-05T10:00:05.000Z',
  ingestedAt: '2026-10-05T10:00:06.000Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  title: `녹음 ${id}`,
  ...(recordingDurationMs === undefined ? {} : { recordingDurationMs }),
});

function segment(
  recordingSourceId: string,
  ordinal: number,
  status: 'unreviewed' | 'needs_review' | 'reviewed',
  durationMs: number,
): TranscriptEvidenceSegment {
  return {
    id: `${recordingSourceId}:segment:${ordinal}:r1`,
    transcriptId: `${recordingSourceId}:segment:${ordinal}`,
    recordingSourceId,
    segmentOrdinal: ordinal,
    revision: 1,
    text: '로컬 검토 전용 문장',
    language: 'ko-KR',
    recordingDurationMs: durationMs,
    audioRange: { startMs: ordinal * 1000, endMs: (ordinal + 1) * 1000 },
    effectiveAt: '2026-10-05T10:00:00.000Z',
    recordedAt: '2026-10-05T10:00:05.000Z',
    ingestedAt: '2026-10-05T10:00:06.000Z',
    provenance: {
      origin: 'derived',
      sourceRecordIds: [recordingSourceId],
      source: {
        system: 'Apple Speech',
        sourceIdentifier: 'speech_transcriber',
        sourceVersion: 'iOS 27',
        productType: 'on-device-speech-transcription',
      },
    },
    reviewState:
      status === 'reviewed'
        ? {
            status,
            reviewerId: 'local-user',
            reviewedAt: '2026-10-05T10:00:08.000Z',
          }
        : status === 'needs_review'
          ? { status, reason: 'correction' }
          : { status },
  };
}

function audioDeletion(): RecordingAudioDeletion {
  return {
    reconcile: jest.fn(async () => {}),
    stage: jest.fn(async () => {}),
    restore: jest.fn(async () => {}),
    commit: jest.fn(async () => {}),
  };
}

test('summarizes real duration and latest transcript review state for saved recordings', async () => {
  const current = source('recording-current', 12500);
  const legacy = source('recording-legacy');
  const pending = source('recording-pending');
  const repository = {
    list: jest.fn(async (kind: string) => {
      if (kind === 'source_record') return [current, legacy, pending];
      if (kind === 'transcript_segment') {
        return [
          segment(current.id, 0, 'reviewed', 12500),
          segment(current.id, 1, 'needs_review', 12500),
          segment(legacy.id, 0, 'reviewed', 6000),
        ];
      }
      return [];
    }),
  } as unknown as RecordRepository;
  const service = createRecordingLibraryService({
    loadRepository: async () => repository,
    audioDeletion: audioDeletion(),
  });

  await expect(service.listSummaries!()).resolves.toEqual([
    {
      source: current,
      durationMs: 12500,
      transcriptReviewState: 'needsReview',
    },
    {
      source: legacy,
      durationMs: 6000,
      transcriptReviewState: 'reviewed',
    },
    {
      source: pending,
      durationMs: null,
      transcriptReviewState: 'notTranscribed',
    },
  ]);
});
