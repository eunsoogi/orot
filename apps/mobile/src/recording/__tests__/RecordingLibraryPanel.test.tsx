import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { SourceRecord, TranscriptEvidenceSegment } from '@orot/domain';
import type { TranscriptEvidenceService } from '../../transcription/transcriptEvidenceService';
import RecordingLibraryPanel from '../RecordingLibraryPanel';
import type { RecordingLibraryService } from '../recordingLibraryService';

const firstSource: SourceRecord = {
  id: 'recording-1',
  sourceKind: 'audio_recording',
  effectiveAt: '2026-10-05T10:00:00.000Z',
  recordedAt: '2026-10-05T10:00:05.000Z',
  ingestedAt: '2026-10-05T10:00:06.000Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  title: '첫 상담 녹음',
};

const secondSource: SourceRecord = {
  ...firstSource,
  id: 'recording-2',
  recordedAt: '2026-10-06T10:00:05.000Z',
  title: '두 번째 상담 녹음',
};

const segment: TranscriptEvidenceSegment = {
  id: 'recording-1:segment:0:r1',
  transcriptId: 'recording-1:segment:0',
  recordingSourceId: firstSource.id,
  segmentOrdinal: 0,
  revision: 1,
  text: '검토 전 전사 내용',
  language: 'ko-KR',
  recordingDurationMs: 5000,
  audioRange: { startMs: 0, endMs: 1000 },
  effectiveAt: firstSource.effectiveAt,
  recordedAt: firstSource.recordedAt,
  ingestedAt: firstSource.ingestedAt,
  provenance: { origin: 'derived', sourceRecordIds: [firstSource.id] },
  reviewState: { status: 'unreviewed' },
};

function createLibraryService(): RecordingLibraryService {
  let sources = [firstSource, secondSource];
  return {
    list: jest.fn(async () => sources),
    deleteRecording: jest.fn(async (id: string) => {
      sources = sources.filter(source => source.id !== id);
      return { audioCleanupPending: false };
    }),
  };
}

function createTranscriptService(): TranscriptEvidenceService {
  return {
    load: jest.fn(async (id?: string) => {
      const source = id
        ? [firstSource, secondSource].find(item => item.id === id)
        : secondSource;
      return source
        ? {
            source,
            segments: source.id === firstSource.id ? [segment] : [],
            staleArtifacts: [],
          }
        : null;
    }),
    transcribe: jest.fn(async () => []),
    correct: jest.fn(),
    play: jest.fn(),
  };
}

test('cancelling list deletion keeps the saved recording available', async () => {
  const service = createLibraryService();
  await render(
    <RecordingLibraryPanel
      service={service}
      transcriptService={createTranscriptService()}
    />,
  );

  await screen.findByTestId('recording-library-item-recording-1');
  await fireEvent.press(screen.getByTestId('recording-delete-recording-1'));
  const confirmation = await screen.findByTestId(
    'recording-delete-confirmation',
  );
  expect(confirmation.props.accessibilityViewIsModal).toBe(true);
  await fireEvent.press(screen.getByTestId('recording-delete-cancel'));

  expect(service.deleteRecording).not.toHaveBeenCalled();
  expect(screen.getByTestId('recording-library-item-recording-1')).toBeTruthy();
  expect(screen.getByTestId('recording-library-item-recording-2')).toBeTruthy();
});

test('a source deletion failure keeps the recording in the list', async () => {
  const service = createLibraryService();
  jest
    .mocked(service.deleteRecording)
    .mockRejectedValueOnce(new Error('local source deletion failed'));
  await render(
    <RecordingLibraryPanel
      service={service}
      transcriptService={createTranscriptService()}
    />,
  );

  await screen.findByTestId('recording-library-item-recording-1');
  await fireEvent.press(screen.getByTestId('recording-delete-recording-1'));
  await fireEvent.press(await screen.findByTestId('recording-delete-confirm'));

  expect(await screen.findByTestId('recording-delete-error')).toBeTruthy();
  expect(screen.getByTestId('recording-library-item-recording-1')).toBeTruthy();
  expect(service.list).toHaveBeenCalledTimes(2);
});

test('reports deferred audio cleanup when the source is already deleted', async () => {
  const service = createLibraryService();
  jest.mocked(service.deleteRecording).mockResolvedValueOnce({
    audioCleanupPending: true,
  });
  await render(
    <RecordingLibraryPanel
      service={service}
      transcriptService={createTranscriptService()}
    />,
  );

  await screen.findByTestId('recording-library-item-recording-1');
  jest
    .mocked(service.list)
    .mockRejectedValueOnce(new Error('recovery unavailable'));
  await fireEvent.press(screen.getByTestId('recording-delete-recording-1'));
  await fireEvent.press(await screen.findByTestId('recording-delete-confirm'));

  expect(
    await screen.findByTestId('recording-delete-cleanup-pending'),
  ).toBeTruthy();
  expect(screen.queryByTestId('recording-library-item-recording-1')).toBeNull();
  expect(screen.queryByTestId('recording-delete-error')).toBeNull();
});

test('opens a recording detail and deletes it from the transcript panel', async () => {
  const service = createLibraryService();
  const transcriptService = createTranscriptService();
  const onSourceDeleted = jest.fn();
  await render(
    <RecordingLibraryPanel
      onSourceDeleted={onSourceDeleted}
      service={service}
      transcriptService={transcriptService}
    />,
  );

  await screen.findByTestId('recording-library-item-recording-1');
  await fireEvent.press(screen.getByTestId('recording-details-recording-1'));
  await screen.findByTestId('recording-detail');
  expect(await screen.findByText(segment.text)).toBeTruthy();
  await fireEvent.press(screen.getByTestId('recording-transcript-delete'));
  await fireEvent.press(await screen.findByTestId('recording-delete-confirm'));

  await waitFor(() => {
    expect(
      screen.queryByTestId('recording-library-item-recording-1'),
    ).toBeNull();
  });
  expect(service.deleteRecording).toHaveBeenCalledWith(firstSource.id);
  expect(transcriptService.load).toHaveBeenCalledWith(firstSource.id);
  expect(onSourceDeleted).toHaveBeenCalledWith(firstSource.id);
});

test('deletes the latest saved recording from the unselected transcript preview', async () => {
  const service = createLibraryService();
  const transcriptService = createTranscriptService();
  await render(
    <RecordingLibraryPanel
      service={service}
      transcriptService={transcriptService}
    />,
  );

  await screen.findByTestId('recording-transcript-delete');
  await fireEvent.press(screen.getByTestId('recording-transcript-delete'));
  await fireEvent.press(await screen.findByTestId('recording-delete-confirm'));

  expect(service.deleteRecording).toHaveBeenCalledWith(secondSource.id);
});

test('deletes a saved recording from its detail screen after confirmation', async () => {
  const service = createLibraryService();
  await render(
    <RecordingLibraryPanel
      service={service}
      transcriptService={createTranscriptService()}
    />,
  );

  await screen.findByTestId('recording-library-item-recording-1');
  await fireEvent.press(screen.getByTestId('recording-details-recording-1'));
  await screen.findByTestId('recording-detail');
  await fireEvent.press(screen.getByTestId('recording-detail-delete'));
  await fireEvent.press(await screen.findByTestId('recording-delete-confirm'));

  await waitFor(() => {
    expect(
      screen.queryByTestId('recording-library-item-recording-1'),
    ).toBeNull();
  });
  expect(service.deleteRecording).toHaveBeenCalledWith(firstSource.id);
});
