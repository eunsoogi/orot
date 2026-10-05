import { act, fireEvent, render, screen } from '@testing-library/react-native';
import {
  isSyntheticRecordingProbeAvailable,
  prepareSyntheticRecordingProbe,
  simulateRecordingInterruption,
} from '../nativeRecordingBridge';
import RecordingScreen from '../RecordingScreen';
import { completed, createService } from '../recordingScreenSupport';

jest.mock('../nativeRecordingBridge', () => ({
  nativeRecordingBridge: {},
  isSyntheticRecordingProbeAvailable: jest.fn(() => false),
  prepareSyntheticRecordingProbe: jest.fn(),
  simulateRecordingInterruption: jest.fn(),
}));

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

  await fireEvent.press(
    screen.getByTestId('recording-probe-interruption-began'),
  );
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

  await fireEvent.press(
    screen.getByTestId('recording-probe-interruption-ended'),
  );
  expect(simulateRecordingInterruption).toHaveBeenLastCalledWith('ended');
});
