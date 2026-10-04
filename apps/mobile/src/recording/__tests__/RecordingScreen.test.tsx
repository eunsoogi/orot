import { act, fireEvent, render, screen } from '@testing-library/react-native';
import {
  isSyntheticRecordingProbeAvailable,
  prepareSyntheticRecordingProbe,
  simulateRecordingInterruption,
} from '../nativeRecordingBridge';
import RecordingScreen from '../RecordingScreen';
import type {
  CompletedRecording,
  RecordingSourceRecord,
  RecordingService,
  RecordingSnapshot,
} from '../recordingTypes';

jest.mock('../nativeRecordingBridge', () => ({
  nativeRecordingBridge: {},
  isSyntheticRecordingProbeAvailable: jest.fn(() => false),
  prepareSyntheticRecordingProbe: jest.fn(),
  simulateRecordingInterruption: jest.fn(),
}));

const idle: RecordingSnapshot = {
  status: 'idle',
  id: null,
  durationMs: 0,
  consentAcknowledged: false,
};

const completed: CompletedRecording = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  durationMs: 12_500,
  startedAt: '2026-10-04T01:00:00.000Z',
  completedAt: '2026-10-04T01:00:12.500Z',
  fileProtection: 'complete',
  excludedFromBackup: true,
};

const savedSource: RecordingSourceRecord = {
  id: completed.id,
  sourceKind: 'audio_recording',
  effectiveAt: completed.startedAt,
  recordedAt: completed.completedAt,
  ingestedAt: '2026-10-04T02:00:00.000Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  title: '상담 녹음',
};

function createService() {
  let listener: ((snapshot: RecordingSnapshot) => void) | undefined;
  const service: RecordingService = {
    getState: jest.fn(async () => idle),
    subscribe: jest.fn((callback: (snapshot: RecordingSnapshot) => void) => {
      listener = callback;
      return jest.fn();
    }),
    start: jest.fn(async () => ({
      ...idle,
      status: 'recording' as const,
      id: completed.id,
      consentAcknowledged: true,
    })),
    pause: jest.fn(async () => ({
      ...idle,
      status: 'paused' as const,
      id: completed.id,
    })),
    resume: jest.fn(async () => ({
      ...idle,
      status: 'recording' as const,
      id: completed.id,
      consentAcknowledged: true,
    })),
    stop: jest.fn(async () => completed),
    saveSource: jest.fn(async () => savedSource),
  };
  return { service, emit: (snapshot: RecordingSnapshot) => listener?.(snapshot) };
}

test('requires an explicit consent action and completes a local source link', async () => {
  const { service } = createService();
  await render(<RecordingScreen onBack={jest.fn()} service={service} />);
  expect(await screen.findByTestId('recording-status')).toHaveTextContent('녹음하지 않음');
  expect(screen.getByTestId('recording-start')).toBeDisabled();

  await fireEvent.press(screen.getByTestId('recording-consent'));
  expect(screen.getByTestId('recording-start')).toBeEnabled();
  await fireEvent.press(screen.getByTestId('recording-start'));
  expect(service.start).toHaveBeenCalledWith(true);
  expect(await screen.findByTestId('recording-status')).toHaveTextContent('녹음 중');

  await fireEvent.press(screen.getByTestId('recording-pause'));
  expect(await screen.findByTestId('recording-status')).toHaveTextContent('일시 정지됨');
  await fireEvent.press(screen.getByTestId('recording-resume'));
  expect(await screen.findByTestId('recording-status')).toHaveTextContent('녹음 중');
  await fireEvent.press(screen.getByTestId('recording-stop'));

  expect(service.saveSource).toHaveBeenCalledWith(completed);
  expect(await screen.findByTestId('recording-source-id')).toHaveTextContent(
    new RegExp(completed.id),
  );
  expect(screen.getByTestId('recording-saved-duration')).toHaveTextContent(/00:12/);
  expect(screen.getByText('녹음을 이 기기에 저장했어요.')).toBeTruthy();
});

test('keeps an interrupted recording paused until the user resumes it', async () => {
  const { service, emit } = createService();
  await render(<RecordingScreen onBack={jest.fn()} service={service} />);
  await screen.findByTestId('recording-status');
  await fireEvent.press(screen.getByTestId('recording-consent'));
  await fireEvent.press(screen.getByTestId('recording-start'));
  await act(async () => {
    emit({
      status: 'interrupted',
      id: completed.id,
      durationMs: 5_000,
      consentAcknowledged: true,
    });
  });

  expect(await screen.findByTestId('recording-status')).toHaveTextContent('오디오가 중단되어 녹음이 일시 정지됨');
  expect(screen.queryByTestId('recording-back')).toBeNull();
  expect(service.resume).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('recording-resume'));
  expect(service.resume).toHaveBeenCalledTimes(1);
});

test('offers metadata retry after audio has already been saved locally', async () => {
  const { service } = createService();
  (service.saveSource as jest.Mock)
    .mockRejectedValueOnce(new Error('local database unavailable'))
    .mockResolvedValueOnce(savedSource);
  await render(<RecordingScreen onBack={jest.fn()} service={service} />);
  await screen.findByTestId('recording-status');
  await fireEvent.press(screen.getByTestId('recording-consent'));
  await fireEvent.press(screen.getByTestId('recording-start'));
  await fireEvent.press(screen.getByTestId('recording-stop'));
  expect(await screen.findByText(/기록 연결을 다시 저장한 뒤/)).toBeTruthy();

  await fireEvent.press(screen.getByTestId('recording-retry-save'));
  expect(await screen.findByText('녹음을 이 기기에 저장했어요.')).toBeTruthy();
  expect(service.saveSource).toHaveBeenCalledTimes(2);
});

test('keeps a protected recording retryable after remount until metadata linking succeeds', async () => {
  const { service } = createService();
  (service.saveSource as jest.Mock)
    .mockRejectedValueOnce(new Error('local database unavailable'))
    .mockResolvedValueOnce(savedSource);
  const view = await render(<RecordingScreen onBack={jest.fn()} service={service} />);
  await screen.findByTestId('recording-status');
  await fireEvent.press(screen.getByTestId('recording-consent'));
  await fireEvent.press(screen.getByTestId('recording-start'));
  await fireEvent.press(screen.getByTestId('recording-stop'));

  expect(await screen.findByTestId('recording-retry-save')).toBeTruthy();
  expect(screen.queryByTestId('recording-back')).toBeNull();
  await fireEvent.press(screen.getByTestId('recording-consent'));
  expect(screen.getByTestId('recording-start')).toBeDisabled();

  await view.unmount();
  await render(<RecordingScreen onBack={jest.fn()} service={service} />);
  expect(await screen.findByTestId('recording-retry-save')).toBeTruthy();
  expect(screen.getByTestId('recording-source-id')).toHaveTextContent(
    new RegExp(completed.id),
  );
  expect(screen.queryByTestId('recording-back')).toBeNull();
  await fireEvent.press(screen.getByTestId('recording-consent'));
  expect(screen.getByTestId('recording-start')).toBeDisabled();

  await fireEvent.press(screen.getByTestId('recording-retry-save'));
  expect(await screen.findByText('녹음을 이 기기에 저장했어요.')).toBeTruthy();
  expect(screen.getByTestId('recording-back')).toBeTruthy();
  expect(service.saveSource).toHaveBeenNthCalledWith(2, completed);
});

test('preserves the previous completion when a later start fails', async () => {
  const { service } = createService();
  await render(<RecordingScreen onBack={jest.fn()} service={service} />);
  await screen.findByTestId('recording-status');
  await fireEvent.press(screen.getByTestId('recording-consent'));
  await fireEvent.press(screen.getByTestId('recording-start'));
  await fireEvent.press(screen.getByTestId('recording-stop'));
  expect(await screen.findByTestId('recording-source-id')).toHaveTextContent(
    new RegExp(completed.id),
  );

  (service.start as jest.Mock).mockRejectedValueOnce(new Error('new start failed'));
  await fireEvent.press(screen.getByTestId('recording-consent'));
  await fireEvent.press(screen.getByTestId('recording-start'));

  expect(await screen.findByTestId('recording-source-id')).toHaveTextContent(
    new RegExp(completed.id),
  );
  expect(screen.getByText('녹음을 이 기기에 저장했어요.')).toBeTruthy();
});

test('withholds source linking when the completed file protection is unverified', async () => {
  const { service } = createService();
  service.stop = jest.fn(async () => ({
    ...completed,
    fileProtection: 'unverified' as const,
  }));
  (service.saveSource as jest.Mock).mockRejectedValue({
    code: 'RECORDING_FILE_PROTECTION_FAILED',
  });
  await render(<RecordingScreen onBack={jest.fn()} service={service} />);
  await screen.findByTestId('recording-status');
  await fireEvent.press(screen.getByTestId('recording-consent'));
  await fireEvent.press(screen.getByTestId('recording-start'));
  await fireEvent.press(screen.getByTestId('recording-stop'));

  expect(
    await screen.findByText(/보호 상태를 확인하지 못해 기록 연결을 보류했어요/),
  ).toBeTruthy();
  expect(screen.queryByTestId('recording-retry-save')).toBeNull();
});

test('shows the matching debug interruption action for each probe phase', async () => {
  jest.mocked(isSyntheticRecordingProbeAvailable).mockReturnValue(true);
  jest.mocked(prepareSyntheticRecordingProbe).mockResolvedValue(undefined);
  jest.mocked(simulateRecordingInterruption).mockResolvedValue(undefined);
  const { service, emit } = createService();
  await render(<RecordingScreen onBack={jest.fn()} service={service} />);
  await screen.findByTestId('recording-status');
  await fireEvent.press(screen.getByTestId('recording-probe-synthetic'));
  await fireEvent.press(screen.getByTestId('recording-consent'));
  await fireEvent.press(screen.getByTestId('recording-start'));

  await fireEvent.press(screen.getByTestId('recording-probe-interruption-began'));
  expect(simulateRecordingInterruption).toHaveBeenLastCalledWith('began');
  await act(async () => {
    emit({
      status: 'interrupted',
      id: completed.id,
      durationMs: 5_000,
      consentAcknowledged: true,
    });
  });
  expect(screen.getByTestId('recording-probe-interruption-ended')).toBeTruthy();
  expect(screen.queryByTestId('recording-probe-interruption-began')).toBeNull();

  await fireEvent.press(screen.getByTestId('recording-probe-interruption-ended'));
  expect(simulateRecordingInterruption).toHaveBeenLastCalledWith('ended');
});
