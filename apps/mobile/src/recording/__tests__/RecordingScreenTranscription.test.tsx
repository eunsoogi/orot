import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import RecordingScreen from '../RecordingScreen';
import type { TranscriptEvidenceService } from '../../transcription/transcriptEvidenceService';
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

function transcriptService(
  transcribe: TranscriptEvidenceService['transcribe'] = async () => [],
): TranscriptEvidenceService {
  return {
    load: jest.fn(async () => ({
      source: savedSource,
      segments: [],
      staleArtifacts: [],
    })),
    transcribe: jest.fn(transcribe),
    correct: jest.fn(),
    play: jest.fn(),
  };
}

async function startAndStopRecording() {
  await screen.findByTestId('recording-status');
  await fireEvent.press(screen.getByTestId('recording-consent'));
  await fireEvent.press(screen.getByTestId('recording-start'));
  await fireEvent.press(screen.getByTestId('recording-stop'));
}

test('exposes transcript review and keeps source export available', async () => {
  const { service } = createService();
  const transcripts = transcriptService();
  await render(
    <RecordingScreen
      onBack={jest.fn()}
      service={service}
      transcriptService={transcripts}
    />,
  );

  await startAndStopRecording();
  expect(await screen.findByText('전사 검토')).toBeTruthy();
  expect(await screen.findByTestId('recording-export-audio')).toBeTruthy();
  expect(screen.getByTestId('recording-export-transcript')).toBeEnabled();
  expect(
    await screen.findByText('이 녹음에는 저장된 전사 내용이 없어요.'),
  ).toBeTruthy();
  const controlsScroll = screen.getByTestId('recording-controls-scroll');
  expect(controlsScroll.props.keyboardDismissMode).toBe('on-drag');
  expect(transcripts.load).toHaveBeenCalledWith(completed.id);
});

test('starts transcription after saving audio and keeps progress visible', async () => {
  const { service } = createService();
  let finishTranscription: ((segments: never[]) => void) | undefined;
  const pendingTranscription = new Promise<never[]>(resolve => {
    finishTranscription = resolve;
  });
  const transcripts = transcriptService(() => pendingTranscription);
  await render(
    <RecordingScreen
      onBack={jest.fn()}
      service={service}
      transcriptService={transcripts}
    />,
  );

  await startAndStopRecording();
  await waitFor(() => {
    expect(transcripts.transcribe).toHaveBeenCalledWith(
      completed.id,
      expect.any(AbortSignal),
    );
  });
  expect(screen.getByTestId('recording-transcription-progress')).toBeTruthy();
  expect(screen.getByTestId('recording-source-id')).toHaveTextContent(
    new RegExp(completed.id),
  );
  expect(screen.queryByTestId('transcript-create')).toBeNull();

  await act(async () => finishTranscription?.([]));
  await waitFor(() => {
    expect(screen.queryByTestId('recording-transcription-progress')).toBeNull();
  });
});

test('shows retry after on-device transcription fails and reuses the saved audio', async () => {
  const { service } = createService();
  let finishRetry: ((segments: never[]) => void) | undefined;
  const pendingRetry = new Promise<never[]>(resolve => {
    finishRetry = resolve;
  });
  const transcribe = jest
    .fn<
      ReturnType<TranscriptEvidenceService['transcribe']>,
      Parameters<TranscriptEvidenceService['transcribe']>
    >()
    .mockRejectedValueOnce(new Error('on-device transcription unavailable'))
    .mockReturnValueOnce(pendingRetry);
  const transcripts = transcriptService(transcribe);
  await render(
    <RecordingScreen
      onBack={jest.fn()}
      service={service}
      transcriptService={transcripts}
    />,
  );

  await startAndStopRecording();
  expect(
    await screen.findByTestId('recording-transcription-failed'),
  ).toBeTruthy();
  expect(service.saveSource).toHaveBeenCalledWith(completed);
  expect(screen.getByTestId('recording-source-id')).toHaveTextContent(
    new RegExp(completed.id),
  );

  await fireEvent.press(screen.getByTestId('recording-transcription-retry'));
  expect(
    await screen.findByTestId('recording-transcription-progress'),
  ).toBeTruthy();
  expect(transcribe).toHaveBeenCalledTimes(2);
  expect(transcribe).toHaveBeenLastCalledWith(
    completed.id,
    expect.any(AbortSignal),
  );
  await act(async () => finishRetry?.([]));
});

test('does not start transcription until the recording source is linked', async () => {
  const { service } = createService();
  (service.saveSource as jest.Mock).mockRejectedValueOnce(
    new Error('storage unavailable'),
  );
  const transcripts = transcriptService();
  await render(
    <RecordingScreen
      onBack={jest.fn()}
      service={service}
      transcriptService={transcripts}
    />,
  );

  await startAndStopRecording();
  expect(service.saveSource).toHaveBeenCalledWith(completed);
  expect(transcripts.transcribe).not.toHaveBeenCalled();
  expect(screen.getByTestId('recording-source-id')).toHaveTextContent(
    new RegExp(completed.id),
  );

  await fireEvent.press(screen.getByTestId('recording-retry-save'));
  await waitFor(() => {
    expect(transcripts.transcribe).toHaveBeenCalledWith(
      completed.id,
      expect.any(AbortSignal),
    );
  });
});
