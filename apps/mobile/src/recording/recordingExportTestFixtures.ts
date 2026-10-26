import type { SourceRecord, TranscriptEvidenceSegment } from '@orot/domain';
import type { RecordingExportService } from './recordingExportService';
import type {
  TranscriptEvidenceService,
  TranscriptRecordingView,
} from '../transcription/transcriptEvidenceService';

/** Supplies two transcript revisions so panel tests can detect stale exports without native sharing. */
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
  text: '원문 전사',
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
      sourceIdentifier: 'fixture',
      sourceVersion: 'fixture-v1',
    },
  },
  reviewState: { status: 'unreviewed' },
};

export const correction: TranscriptEvidenceSegment = {
  ...original,
  id: 'recording-1:segment:0:r2',
  revision: 2,
  supersedesId: original.id,
  text: '최신 사용자 수정',
  provenance: {
    ...original.provenance,
    origin: 'user_reported',
    sourceRecordIds: [source.id, original.id],
  },
  reviewState: {
    status: 'needs_review',
    reason: 'Transcript text was corrected by the user.',
  },
};

/** Builds per-test transcript and export spies without invoking native sharing. */
export function createServices(segments: TranscriptEvidenceSegment[]) {
  const view: TranscriptRecordingView = {
    source,
    segments,
    staleArtifacts: [],
  };
  const transcriptService: TranscriptEvidenceService = {
    load: jest.fn(async () => view),
    transcribe: jest.fn(async () => segments),
    correct: jest.fn(async () => segments[0]!),
    play: jest.fn(async segment => ({
      startMs: segment.audioRange.startMs,
      endMs: segment.audioRange.endMs,
      actualStartMs: segment.audioRange.startMs,
    })),
  };
  const exportService: RecordingExportService = {
    shareAudio: jest.fn(async () => 'completed'),
    shareTranscript: jest.fn(async () => 'completed'),
  };
  return { transcriptService, exportService };
}
