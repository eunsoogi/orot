import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { TranscriptEvidenceService } from '../../transcription/transcriptEvidenceService';
import RecordingScreen from '../RecordingScreen';
import type { RecordingLibraryService } from '../recordingLibraryService';
import {
  completed,
  createService,
  savedSource,
} from '../recordingScreenSupport';

jest.mock('../nativeRecordingBridge', () => ({
  nativeRecordingBridge: {},
  isSyntheticRecordingProbeAvailable: jest.fn(() => false),
  prepareSyntheticRecordingProbe: jest.fn(),
  simulateRecordingInterruption: jest.fn(),
}));

function createLibraryService(
  deleteRecording: (sourceId: string) => Promise<void> = async () => {},
): RecordingLibraryService {
  let sources = [savedSource];
  return {
    list: jest.fn(async () => sources),
    deleteRecording: jest.fn(async sourceId => {
      await deleteRecording(sourceId);
      sources = sources.filter(source => source.id !== sourceId);
      return { audioCleanupPending: false };
    }),
  };
}

function createTranscriptService(): TranscriptEvidenceService {
  return {
    load: jest.fn(async sourceId =>
      sourceId === undefined || sourceId === savedSource.id
        ? { source: savedSource, segments: [], staleArtifacts: [] }
        : null,
    ),
    transcribe: jest.fn(async () => []),
    correct: jest.fn(),
    play: jest.fn(),
  };
}

test('deleting the latest recording from its detail clears the screen source', async () => {
  const recording = createService().service;
  const library = createLibraryService();
  await render(
    <RecordingScreen
      onBack={jest.fn()}
      service={recording}
      transcriptService={createTranscriptService()}
      recordingLibraryService={library}
    />,
  );
  await fireEvent.press(screen.getByTestId('recording-consent'));
  await fireEvent.press(screen.getByTestId('recording-start'));
  await fireEvent.press(screen.getByTestId('recording-stop'));
  await screen.findByTestId(`recording-library-item-${savedSource.id}`);
  await screen.findByTestId('transcript-panel');
  expect(screen.getAllByTestId('transcript-panel')).toHaveLength(1);

  await fireEvent.press(
    screen.getByTestId(`recording-details-${savedSource.id}`),
  );
  await fireEvent.press(screen.getByTestId('recording-detail-delete'));
  await fireEvent.press(await screen.findByTestId('recording-delete-confirm'));

  await waitFor(() => {
    expect(
      screen.queryByTestId('recording-library-item-' + savedSource.id),
    ).toBeNull();
    expect(screen.queryByTestId('recording-result')).toBeNull();
    expect(screen.getByTestId('recording-status')).toHaveTextContent(
      '녹음하지 않음',
    );
  });
  expect(recording.saveSource).toHaveBeenCalledWith(completed);
  expect(library.deleteRecording).toHaveBeenCalledWith(savedSource.id);
});

test('prevents a new capture while a confirmed recording deletion is in flight', async () => {
  let finishDeletion: (() => void) | undefined;
  const pendingDeletion = new Promise<void>(resolve => {
    finishDeletion = resolve;
  });
  const recording = createService().service;
  const library = createLibraryService(() => pendingDeletion);
  await render(
    <RecordingScreen
      onBack={jest.fn()}
      service={recording}
      transcriptService={createTranscriptService()}
      recordingLibraryService={library}
    />,
  );
  await screen.findByTestId(`recording-library-item-${savedSource.id}`);
  await fireEvent.press(screen.getByTestId('recording-consent'));
  await fireEvent.press(
    screen.getByTestId('recording-delete-' + savedSource.id),
  );

  const confirm = fireEvent.press(
    await screen.findByTestId('recording-delete-confirm'),
  );
  await waitFor(() => expect(library.deleteRecording).toHaveBeenCalled());
  expect(screen.getByTestId('recording-start')).toBeDisabled();
  expect(finishDeletion).toBeDefined();
  finishDeletion?.();
  await confirm;
  await waitFor(() => {
    expect(
      screen.queryByTestId('recording-library-item-' + savedSource.id),
    ).toBeNull();
  });
});
