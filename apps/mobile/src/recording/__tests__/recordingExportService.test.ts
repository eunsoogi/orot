import type { SourceRecord, TranscriptEvidenceSegment } from '@orot/domain';
import {
  EmptyRecordingTranscriptError,
  formatTranscriptExport,
} from '../recordingExportService';
import type { TranscriptRecordingView } from '../../transcription/transcriptEvidenceService';

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
  recordingDurationMs: 20_000,
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
      sourceVersion: 'iOS 26.2',
    },
  },
  reviewState: { status: 'unreviewed' },
};

const correction: TranscriptEvidenceSegment = {
  ...original,
  id: 'recording-1:segment:0:r2',
  revision: 2,
  supersedesId: original.id,
  text: '복용했다고 말했어요.',
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

function view(segments: TranscriptEvidenceSegment[]): TranscriptRecordingView {
  return { source, segments, staleArtifacts: [] };
}

test('exports only the latest corrected revision with Korean text and audio offsets', () => {
  const text = formatTranscriptExport(view([correction, original]));

  expect(text).toContain('내보낸 버전: 최신 사용자 수정본 포함');
  expect(text).toContain('녹음 시작 시각: 2026-10-05T10:00:00.000Z');
  expect(text).toContain('[00:00.250–00:01.801] 사용자 수정 최신본');
  expect(text).toContain('복용했다고 말했어요.');
  expect(text).not.toContain('복용하지 않았어요.');
});

test('labels machine text as original and preserves hour-length offsets', () => {
  const longSegment = {
    ...original,
    audioRange: { startMs: 3_600_250, endMs: 3_601_801 },
    recordingDurationMs: 3_700_000,
  };
  const text = formatTranscriptExport(view([longSegment]));

  expect(text).toContain('내보낸 버전: 기기 전사 원문');
  expect(text).toContain('[01:00:00.250–01:00:01.801] 기기 전사 원문');
});

test('refuses to create an empty transcript export', () => {
  expect(() => formatTranscriptExport(view([]))).toThrow(
    EmptyRecordingTranscriptError,
  );
});
