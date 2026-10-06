import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { SourceRecord, TranscriptEvidenceSegment } from '@orot/domain';
import TranscriptEvidencePanel from '../TranscriptEvidencePanel';
import type {
  TranscriptEvidenceService,
  TranscriptRecordingView,
} from '../transcriptEvidenceService';

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

test('shows provenance and range, preserves correction history, and plays the selected evidence', async () => {
  let view: TranscriptRecordingView = {
    source,
    segments: [original],
    staleArtifacts: [],
  };
  const service: TranscriptEvidenceService = {
    load: jest.fn(async () => view),
    transcribe: jest.fn(async () => [original]),
    correct: jest.fn(async () => {
      view = {
        source,
        segments: [original, correction],
        staleArtifacts: [
          {
            kind: 'visit_question',
            id: 'question-1',
            supersededSegmentId: original.id,
            currentSegmentId: correction.id,
            invalidatedAt: '2026-10-05T10:02:00.000Z',
          },
        ],
      };
      return correction;
    }),
    play: jest.fn(async segment => ({
      startMs: segment.audioRange.startMs,
      endMs: segment.audioRange.endMs,
      actualStartMs: segment.audioRange.startMs,
    })),
  };
  await render(
    <TranscriptEvidencePanel recordingSourceId={source.id} service={service} />,
  );

  expect(await screen.findByText('복용하지 않았어요.')).toBeTruthy();
  expect(screen.getByTestId('transcript-origin-0')).toHaveTextContent(
    '기계 전사',
  );
  expect(
    screen.getByTestId('transcript-clinician-verification-0'),
  ).toHaveTextContent('의료진 확인 기록 없음');
  expect(screen.getByText('엔진: dictation_transcriber')).toBeTruthy();
  expect(screen.getByText('시스템 버전: iOS 26.2 (23C54)')).toBeTruthy();
  expect(screen.getByText('00:00.250–00:01.801')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('transcript-play-0'));
  expect(service.play).toHaveBeenCalledWith(original);

  await fireEvent.press(screen.getByTestId('transcript-edit-0'));
  await fireEvent.changeText(
    screen.getByTestId('transcript-input-0'),
    correction.text,
  );
  await fireEvent.press(screen.getByTestId('transcript-save-0'));

  await waitFor(() => expect(screen.getByText(correction.text)).toBeTruthy());
  expect(screen.getByTestId('transcript-history-0-1')).toBeTruthy();
  expect(screen.getByTestId('transcript-stale-artifacts')).toBeTruthy();
  expect(screen.getByText('수정됨 · 다시 확인 필요')).toBeTruthy();
  expect(screen.getByTestId('transcript-origin-0')).toHaveTextContent(
    '사용자 수정',
  );
  expect(service.correct).toHaveBeenCalledWith(original.id, correction.text);
});
