import { fireEvent, render, screen } from '@testing-library/react-native';
import type { SourceRecord, TranscriptEvidenceSegment } from '@orot/domain';
import RecordingExportPanel from '../RecordingExportPanel';
import type { RecordingExportService } from '../recordingExportService';
import type {
  TranscriptEvidenceService,
  TranscriptRecordingView,
} from '../../transcription/transcriptEvidenceService';

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

const correction: TranscriptEvidenceSegment = {
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

function createServices(segments: TranscriptEvidenceSegment[]) {
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

test('exports the current transcript revision only after an explicit press', async () => {
  const { transcriptService, exportService } = createServices([
    original,
    correction,
  ]);
  await render(
    <RecordingExportPanel
      recordingSourceId={source.id}
      transcriptService={transcriptService}
      exportService={exportService}
    />,
  );

  const button = await screen.findByTestId('recording-export-transcript');
  expect(exportService.shareTranscript).not.toHaveBeenCalled();
  await fireEvent.press(button);

  expect(exportService.shareTranscript).toHaveBeenCalledWith(
    expect.stringContaining('최신 사용자 수정'),
  );
  expect(exportService.shareTranscript).toHaveBeenCalledWith(
    expect.not.stringContaining('원문 전사'),
  );
  expect(
    await screen.findByTestId('recording-export-status'),
  ).toHaveTextContent('파일을 공유하거나 저장했어요.');
});

test('keeps empty transcript export actionable and reports that no content exists', async () => {
  const { transcriptService, exportService } = createServices([]);
  await render(
    <RecordingExportPanel
      recordingSourceId={source.id}
      transcriptService={transcriptService}
      exportService={exportService}
    />,
  );

  expect(
    await screen.findByText('아직 내보낼 전사 내용이 없어요.'),
  ).toBeTruthy();
  const button = screen.getByTestId('recording-export-transcript');
  expect(button).toBeEnabled();
  await fireEvent.press(button);
  expect(await screen.findByTestId('recording-export-error')).toHaveTextContent(
    '저장된 전사 내용이 없어요.',
  );
  expect(exportService.shareTranscript).not.toHaveBeenCalled();
});

test('refreshes after transcript text appears following the initial empty read', async () => {
  const { transcriptService, exportService } = createServices([]);
  transcriptService.load = jest
    .fn()
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({
      source,
      segments: [original],
      staleArtifacts: [],
    });

  await render(
    <RecordingExportPanel
      recordingSourceId={source.id}
      transcriptService={transcriptService}
      exportService={exportService}
    />,
  );

  // The exporter and transcript creator mount together before any text exists.
  const button = await screen.findByTestId('recording-export-transcript');
  expect(button).toBeEnabled();
  await fireEvent.press(button);

  expect(transcriptService.load).toHaveBeenCalledTimes(2);
  expect(exportService.shareTranscript).toHaveBeenCalledWith(
    expect.stringContaining('원문 전사'),
  );
  expect(
    await screen.findByTestId('recording-export-status'),
  ).toHaveTextContent('파일을 공유하거나 저장했어요.');
});

test('keeps audio export available when transcript lookup fails', async () => {
  const { transcriptService, exportService } = createServices([original]);
  transcriptService.load = jest.fn(async () => {
    throw new Error('transcript storage unavailable');
  });
  await render(
    <RecordingExportPanel
      recordingSourceId={source.id}
      transcriptService={transcriptService}
      exportService={exportService}
    />,
  );

  expect(await screen.findByTestId('recording-export-error')).toHaveTextContent(
    '전사 정보를 불러오지 못했어요.',
  );
  await fireEvent.press(screen.getByTestId('recording-export-audio'));
  expect(exportService.shareAudio).toHaveBeenCalledWith(source.id);
  expect(
    await screen.findByTestId('recording-export-status'),
  ).toHaveTextContent('파일을 공유하거나 저장했어요.');
});

test('distinguishes cancellation from a missing original recording file', async () => {
  const { transcriptService, exportService } = createServices([original]);
  exportService.shareAudio = jest.fn(async () => 'cancelled');
  await render(
    <RecordingExportPanel
      recordingSourceId={source.id}
      transcriptService={transcriptService}
      exportService={exportService}
    />,
  );

  await fireEvent.press(await screen.findByTestId('recording-export-audio'));
  expect(
    await screen.findByTestId('recording-export-status'),
  ).toHaveTextContent('내보내기를 취소했어요.');

  exportService.shareAudio = jest.fn(async () => {
    throw Object.assign(new Error('missing source'), {
      code: 'RECORDING_EXPORT_SOURCE_MISSING',
    });
  });
  await fireEvent.press(screen.getByTestId('recording-export-audio'));
  expect(await screen.findByTestId('recording-export-error')).toHaveTextContent(
    '녹음 원본 파일을 찾을 수 없어요.',
  );
});

test('reports an iOS activity failure without claiming export success', async () => {
  const { transcriptService, exportService } = createServices([original]);
  exportService.shareTranscript = jest.fn(async () => {
    throw Object.assign(new Error('activity failed'), {
      code: 'RECORDING_EXPORT_FAILED',
    });
  });
  await render(
    <RecordingExportPanel
      recordingSourceId={source.id}
      transcriptService={transcriptService}
      exportService={exportService}
    />,
  );

  await fireEvent.press(
    await screen.findByTestId('recording-export-transcript'),
  );
  expect(await screen.findByTestId('recording-export-error')).toHaveTextContent(
    '파일을 내보내지 못했어요. 다시 시도해 주세요.',
  );
  expect(screen.queryByTestId('recording-export-status')).toBeNull();
});
