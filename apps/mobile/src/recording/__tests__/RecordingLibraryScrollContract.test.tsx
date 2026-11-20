import { render, screen, within } from '@testing-library/react-native';
import RecordingScreen from '../RecordingScreen';
import { createService } from '../recordingScreenSupport';

jest.mock('../nativeRecordingBridge', () => ({
  nativeRecordingBridge: {},
  isSyntheticRecordingProbeAvailable: jest.fn(() => false),
  prepareSyntheticRecordingProbe: jest.fn(),
  simulateRecordingInterruption: jest.fn(),
}));

// This is the standalone production composition used by the synthetic library fixture.
test('saved library belongs to the review scroller, not the fullscreen capture frame', async () => {
  const { service } = createService();
  await render(<RecordingScreen onBack={jest.fn()} service={service} />);
  await screen.findByTestId('recording-status');
  const scroll = screen.getByTestId('recording-review-scroll');
  expect(within(scroll).getByTestId('recording-library-panel')).toBeTruthy();
  expect(screen.queryByTestId('recording-controls-scroll')).toBeNull();
});
