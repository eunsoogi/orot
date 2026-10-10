import { fireEvent, render, screen } from '@testing-library/react-native';
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

// Two screen mounts and the async retry path need more than Jest's 5-second default.
test('keeps a backup-eligible recording retryable after metadata storage fails', async () => {
  const { service } = createService();
  const eligibleRecording = { ...completed, excludedFromBackup: false };
  service.stop = jest.fn(async () => eligibleRecording);
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
  expect(screen.getByTestId('recording-start')).toBeDisabled();

  await view.unmount();
  await render(<RecordingScreen onBack={jest.fn()} service={service} />);
  expect(await screen.findByTestId('recording-retry-save')).toBeTruthy();
  expect(screen.queryByTestId('recording-back')).toBeNull();

  await fireEvent.press(screen.getByTestId('recording-retry-save'));
  expect(await screen.findByText('녹음을 이 기기에 저장했어요.')).toBeTruthy();
  expect(screen.getByTestId('recording-back')).toBeTruthy();
  expect(service.saveSource).toHaveBeenNthCalledWith(2, eligibleRecording);
}, 10000);
