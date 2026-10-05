import { act, fireEvent, render, screen } from '@testing-library/react-native';
import RecordingScreen from '../RecordingScreen';
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

test('requires an explicit consent action and completes a local source link', async () => {
  const { service } = createService();
  await render(<RecordingScreen onBack={jest.fn()} service={service} />);
  expect(await screen.findByTestId('recording-status')).toHaveTextContent(
    '녹음하지 않음',
  );
  expect(screen.getByTestId('recording-start')).toBeDisabled();

  await fireEvent.press(screen.getByTestId('recording-consent'));
  expect(screen.getByTestId('recording-start')).toBeEnabled();
  await fireEvent.press(screen.getByTestId('recording-start'));
  expect(service.start).toHaveBeenCalledWith(true);
  expect(await screen.findByTestId('recording-status')).toHaveTextContent(
    '녹음 중',
  );

  await fireEvent.press(screen.getByTestId('recording-pause'));
  expect(await screen.findByTestId('recording-status')).toHaveTextContent(
    '일시 정지됨',
  );
  await fireEvent.press(screen.getByTestId('recording-resume'));
  expect(await screen.findByTestId('recording-status')).toHaveTextContent(
    '녹음 중',
  );
  await fireEvent.press(screen.getByTestId('recording-stop'));

  expect(service.saveSource).toHaveBeenCalledWith(completed);
  expect(await screen.findByTestId('recording-source-id')).toHaveTextContent(
    new RegExp(completed.id),
  );
  expect(screen.getByTestId('recording-saved-duration')).toHaveTextContent(
    /00:12/,
  );
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

  expect(await screen.findByTestId('recording-status')).toHaveTextContent(
    '오디오가 중단되어 녹음이 일시 정지됨',
  );
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
  const view = await render(
    <RecordingScreen onBack={jest.fn()} service={service} />,
  );
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

  (service.start as jest.Mock).mockRejectedValueOnce(
    new Error('new start failed'),
  );
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
