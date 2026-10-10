import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { SourceRecord, TranscriptEvidenceSegment } from '@orot/domain';
import type {
  TranscriptEvidenceService,
  TranscriptRecordingView,
} from '../../transcription/transcriptEvidenceService';
import RecordingExportPanel from '../RecordingExportPanel';
import type { RecordingExportService } from '../recordingExportService';

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

const segment: TranscriptEvidenceSegment = {
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

const transcriptView: TranscriptRecordingView = {
  source,
  segments: [segment],
  staleArtifacts: [],
};

function createServices() {
  const transcriptService: TranscriptEvidenceService = {
    load: jest.fn(async () => null),
    transcribe: async () => [],
    correct: async () => {
      throw new Error('Unused in selection test.');
    },
    play: async (item: TranscriptEvidenceSegment) => ({
      startMs: item.audioRange.startMs,
      endMs: item.audioRange.endMs,
      actualStartMs: item.audioRange.startMs,
    }),
  };
  const exportService: RecordingExportService = {
    shareAudio: jest.fn(async () => 'completed'),
    shareTranscript: jest.fn(async () => 'completed'),
  };
  return { transcriptService, exportService };
}

test('clears export feedback when the selected recording changes', async () => {
  const { transcriptService, exportService } = createServices();
  const panel = await render(
    <RecordingExportPanel
      recordingSourceId="recording-1"
      transcriptService={transcriptService}
      exportService={exportService}
    />,
  );

  await fireEvent.press(await screen.findByTestId('recording-export-audio'));
  expect(
    await screen.findByTestId('recording-export-status'),
  ).toHaveTextContent('파일을 공유하거나 저장했어요.');

  await panel.rerender(
    <RecordingExportPanel
      recordingSourceId="recording-2"
      transcriptService={transcriptService}
      exportService={exportService}
    />,
  );

  await waitFor(() =>
    expect(screen.queryByTestId('recording-export-status')).toBeNull(),
  );
});

test('does not attach a late share result to a newly selected recording', async () => {
  const { transcriptService, exportService } = createServices();
  let resolveShare!: (status: 'completed' | 'cancelled') => void;
  const pendingShare = new Promise<'completed' | 'cancelled'>(
    resolve => (resolveShare = resolve),
  );
  exportService.shareAudio = jest.fn(() => pendingShare);
  const panel = await render(
    <RecordingExportPanel
      recordingSourceId="recording-1"
      transcriptService={transcriptService}
      exportService={exportService}
    />,
  );

  await fireEvent.press(await screen.findByTestId('recording-export-audio'));
  expect(exportService.shareAudio).toHaveBeenCalledWith('recording-1');

  await panel.rerender(
    <RecordingExportPanel
      recordingSourceId="recording-2"
      transcriptService={transcriptService}
      exportService={exportService}
    />,
  );
  await act(async () => {
    resolveShare('completed');
    await pendingShare;
  });

  await waitFor(() =>
    expect(screen.queryByTestId('recording-export-status')).toBeNull(),
  );
});

test('does not attach a late transcript share result to a newly selected recording', async () => {
  const { transcriptService, exportService } = createServices();
  transcriptService.load = jest.fn(async (recordingSourceId: string) =>
    recordingSourceId === source.id ? transcriptView : null,
  );
  let resolveShare!: (status: 'completed' | 'cancelled') => void;
  const pendingShare = new Promise<'completed' | 'cancelled'>(
    resolve => (resolveShare = resolve),
  );
  exportService.shareTranscript = jest.fn(() => pendingShare);
  const panel = await render(
    <RecordingExportPanel
      recordingSourceId={source.id}
      transcriptService={transcriptService}
      exportService={exportService}
    />,
  );

  await fireEvent.press(
    await screen.findByTestId('recording-export-transcript'),
  );
  await waitFor(() => expect(exportService.shareTranscript).toHaveBeenCalled());

  await panel.rerender(
    <RecordingExportPanel
      recordingSourceId="recording-2"
      transcriptService={transcriptService}
      exportService={exportService}
    />,
  );
  expect(screen.getByTestId('recording-export-audio')).toBeDisabled();
  await act(async () => {
    resolveShare('completed');
    await pendingShare;
  });

  await waitFor(() => {
    expect(screen.queryByTestId('recording-export-status')).toBeNull();
    expect(screen.getByTestId('recording-export-audio')).toBeEnabled();
  });
});
