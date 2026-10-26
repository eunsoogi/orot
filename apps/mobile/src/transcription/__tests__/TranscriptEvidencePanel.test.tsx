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

test('shows review provenance and range, preserves correction history, and plays evidence', async () => {
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
  const onInteractionChange = jest.fn();
  await render(
    <TranscriptEvidencePanel
      recordingSourceId={source.id}
      service={service}
      onInteractionChange={onInteractionChange}
    />,
  );

  expect(screen.getByRole('header', { name: '전사 검토' })).toBeTruthy();
  expect(screen.getByTestId('transcript-local-notice')).toHaveTextContent(
    '전사는 Apple 기기 내 음성 인식으로 처리하고 서버로 보내지 않습니다.',
  );
  expect(screen.getByTestId('transcript-summary')).toHaveTextContent(
    /상담 녹음/,
  );
  expect(screen.getByTestId('transcript-summary-title')).toHaveTextContent(
    '검토 전 초안',
  );
  expect(await screen.findByText('복용하지 않았어요.')).toBeTruthy();
  expect(screen.getByTestId('transcript-origin-0')).toHaveTextContent(
    '기계 전사',
  );
  expect(
    screen.getByTestId('transcript-clinician-verification-0'),
  ).toHaveTextContent('의료진 확인 기록 없음');
  expect(screen.queryByTestId('transcript-engine-0')).toBeNull();
  expect(screen.queryByTestId('transcript-runtime-0')).toBeNull();
  expect(screen.getByText('00:00.250–00:01.801')).toBeTruthy();
  const segmentToggle = screen.getByTestId('transcript-segment-toggle-0');
  expect(segmentToggle.props.accessibilityState).toEqual({ expanded: true });
  await fireEvent.press(segmentToggle);
  expect(screen.queryByTestId('transcript-segment-body-0')).toBeNull();
  await fireEvent.press(segmentToggle);
  expect(screen.getByTestId('transcript-segment-body-0')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('transcript-play-0'));
  expect(service.play).toHaveBeenCalledWith(original);
  expect(service.play).toHaveBeenCalledWith(
    expect.objectContaining({
      provenance: expect.objectContaining({
        source: expect.objectContaining({
          sourceIdentifier: 'dictation_transcriber',
        }),
      }),
    }),
  );
  await fireEvent.press(screen.getByTestId('transcript-play-range-0'));
  expect(service.play).toHaveBeenCalledTimes(2);

  await fireEvent.press(screen.getByTestId('transcript-edit-0'));
  expect(screen.getByTestId('transcript-editor-0')).toBeTruthy();
  const transcriptInput = screen.getByTestId('transcript-input-0');
  // Keep cancel and save after the editor so the parent can scroll them into view.
  expect(
    screen
      .getAllByTestId(
        /^(?:transcript-input-0|transcript-save-0|transcript-cancel-0)$/,
      )
      .map(control => control.props.testID),
  ).toEqual(['transcript-input-0', 'transcript-cancel-0', 'transcript-save-0']);
  await fireEvent.changeText(transcriptInput, correction.text);
  expect(onInteractionChange).toHaveBeenLastCalledWith({
    busy: false,
    dirty: true,
  });
  await fireEvent.press(screen.getByTestId('transcript-save-0'));

  await waitFor(() => expect(screen.getByText(correction.text)).toBeTruthy());
  expect(screen.getByTestId('transcript-history-0-1')).toBeTruthy();
  expect(screen.getByTestId('transcript-stale-artifacts')).toBeTruthy();
  expect(screen.getByTestId('transcript-review-0')).toHaveTextContent(
    '수정됨 · 다시 확인 필요',
  );
  expect(screen.getByTestId('transcript-summary-title')).toHaveTextContent(
    '수정됨 · 다시 확인 필요',
  );
  expect(screen.getByTestId('transcript-origin-0')).toHaveTextContent(
    '사용자 수정',
  );
  expect(service.correct).toHaveBeenCalledWith(original.id, correction.text);
  expect(onInteractionChange).toHaveBeenLastCalledWith({
    busy: false,
    dirty: false,
  });
});

test('can generate missing transcript evidence and recover after a provider failure', async () => {
  let segments: TranscriptEvidenceSegment[] = [];
  const service: TranscriptEvidenceService = {
    load: jest.fn(async () => ({ source, segments, staleArtifacts: [] })),
    transcribe: jest
      .fn()
      .mockRejectedValueOnce(new Error('native failure'))
      .mockImplementationOnce(async () => {
        segments = [original];
        return segments;
      }),
    correct: jest.fn(),
    play: jest.fn(),
  };
  await render(
    <TranscriptEvidencePanel recordingSourceId={source.id} service={service} />,
  );
  await fireEvent.press(await screen.findByTestId('transcript-create'));
  expect(await screen.findByTestId('transcript-error')).toHaveTextContent(
    '녹음을 전사하지 못했어요. 기기 지원 상태를 확인해 주세요.',
  );
  await fireEvent.press(screen.getByTestId('transcript-create'));
  expect(await screen.findByTestId('transcript-text-0')).toHaveTextContent(
    original.text,
  );
  expect(service.transcribe).toHaveBeenNthCalledWith(2, source.id);
});

test('shows a playback error when a transcript segment cannot be played', async () => {
  // Native UI tests keep the actual keyboard and share-sheet paths; RNTL covers this service failure state.
  const service: TranscriptEvidenceService = {
    load: jest.fn(async () => ({
      source,
      segments: [original],
      staleArtifacts: [],
    })),
    transcribe: jest.fn(),
    correct: jest.fn(),
    play: jest.fn().mockRejectedValue(new Error('audio unavailable')),
  };
  await render(
    <TranscriptEvidencePanel recordingSourceId={source.id} service={service} />,
  );

  await fireEvent.press(await screen.findByTestId('transcript-play-0'));

  expect(await screen.findByTestId('transcript-error')).toHaveTextContent(
    '오디오 구간을 재생하지 못했어요.',
  );
  expect(service.play).toHaveBeenCalledWith(original);
});
