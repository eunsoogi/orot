import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import RecordingScreen from '../RecordingScreen';
import { completed, createService } from '../recordingScreenSupport';

jest.mock('../nativeRecordingBridge', () => ({
  nativeRecordingBridge: {},
  isSyntheticRecordingProbeAvailable: jest.fn(() => false),
  prepareSyntheticRecordingProbe: jest.fn(),
  simulateRecordingInterruption: jest.fn(),
}));

const originalWindow = Dimensions.get('window');

async function setWindow(width: number, fontScale: number) {
  await act(() =>
    Dimensions.set({ window: { ...originalWindow, width, fontScale } }),
  );
}

afterEach(async () => {
  await act(() => Dimensions.set({ window: originalWindow }));
});

test('keeps consent and active recording state through width and text-scale reflow', async () => {
  // Page sections stay vertical at wide widths as well as with large text.
  await setWindow(664, 1);
  const { service, emit } = createService();
  await render(<RecordingScreen onBack={jest.fn()} service={service} />);

  await screen.findByTestId('recording-status');
  expect(
    screen.getByTestId('recording-content-columns').props.style,
  ).toMatchObject({ flexDirection: 'column' });
  expect(screen.getByTestId('recording-microphone-control')).toBeDisabled();

  await fireEvent.press(screen.getByTestId('recording-consent'));
  await fireEvent.press(screen.getByTestId('recording-microphone-control'));
  expect(service.start).toHaveBeenCalledWith(true);
  expect(await screen.findByTestId('recording-status')).toHaveTextContent(
    '녹음 중',
  );
  await act(() =>
    emit({
      status: 'recording',
      id: completed.id,
      durationMs: 5_000,
      consentAcknowledged: true,
    }),
  );

  await setWindow(320, 1);
  expect(
    screen.getByTestId('recording-content-columns').props.style,
  ).toMatchObject({ flexDirection: 'column' });
  expect(screen.getByTestId('recording-status')).toHaveTextContent('녹음 중');
  expect(screen.getByTestId('recording-duration')).toHaveTextContent('00:05');
  expect(screen.getByTestId('recording-consent-status')).toHaveTextContent(
    '동의 확인됨',
  );
  expect(screen.getByTestId('recording-consent')).toBeDisabled();

  await setWindow(983, 1.5);
  expect(
    screen.getByTestId('recording-content-columns').props.style,
  ).toMatchObject({ flexDirection: 'column' });
  expect(screen.getByTestId('recording-status')).toHaveTextContent('녹음 중');
  expect(screen.getByTestId('recording-duration')).toHaveTextContent('00:05');
  expect(screen.getByTestId('recording-consent-status')).toHaveTextContent(
    '동의 확인됨',
  );
});
