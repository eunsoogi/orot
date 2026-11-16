import { fireEvent, render, screen } from '@testing-library/react-native';
import RecordingScreen from '../RecordingScreen';
import { completed, createService } from '../recordingScreenSupport';
import {
  bindAutomaticRecordingVisit,
  selectRecordingVisitWithinDeadline,
} from '../bindAutomaticRecordingVisit';
jest.mock('../bindAutomaticRecordingVisit', () => ({
  bindAutomaticRecordingVisit: jest.fn(async () => {}),
  selectRecordingVisitWithinDeadline: jest.fn(async () => null),
}));
jest.mock('../nativeRecordingBridge', () => ({
  nativeRecordingBridge: {},
  isSyntheticRecordingProbeAvailable: jest.fn(() => false),
  prepareSyntheticRecordingProbe: jest.fn(),
  simulateRecordingInterruption: jest.fn(),
}));

const visit = {
  id: 'synthetic-visit',
  effectiveAt: '2026-12-01T10:00:00+09:00',
  status: 'scheduled' as const,
};
test('keeps consent, removes visit choice, and binds the start snapshot only after protected audio is saved', async () => {
  jest.mocked(selectRecordingVisitWithinDeadline).mockResolvedValueOnce(visit);
  const { service } = createService();
  await render(
    <RecordingScreen
      service={service}
      onBack={jest.fn()}
      onOpenSavedRecordings={jest.fn()}
    />,
  );
  expect(
    await screen.findByTestId('recording-microphone-control'),
  ).toBeDisabled();
  expect(screen.queryByTestId('recording-controls-scroll')).toBeNull();
  expect(screen.getByTestId('recording-controls-fullscreen')).toBeTruthy();
  expect(screen.queryByText('연결하지 않기')).toBeNull();
  await fireEvent.press(screen.getByTestId('recording-consent'));
  await fireEvent.press(screen.getByTestId('recording-microphone-control'));
  expect(service.start).toHaveBeenCalledWith(true);
  expect(bindAutomaticRecordingVisit).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('recording-microphone-control'));
  expect(bindAutomaticRecordingVisit).toHaveBeenCalledWith(completed.id, visit);
  expect(screen.getByTestId('recording-result')).toBeTruthy();
  expect(screen.getByTestId('recording-saved-duration')).toHaveTextContent(
    '녹음 시간: 00:12',
  );
  expect(screen.queryByTestId('recording-microphone-control')).toBeNull();
  await fireEvent.press(screen.getByTestId('recording-new-take'));
  expect(screen.queryByTestId('recording-result')).toBeNull();
  expect(screen.getByTestId('recording-microphone-control')).toBeDisabled();
  expect(service.start).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('recording-consent')).toBeTruthy();
  expect(
    jest.mocked(service.saveSource).mock.invocationCallOrder[0],
  ).toBeLessThan(
    jest.mocked(bindAutomaticRecordingVisit).mock.invocationCallOrder[0],
  );
});

test('records without a relationship when no eligible future visit is available', async () => {
  jest.mocked(bindAutomaticRecordingVisit).mockClear();
  jest.mocked(selectRecordingVisitWithinDeadline).mockResolvedValueOnce(null);
  const { service } = createService();
  await render(
    <RecordingScreen
      service={service}
      onBack={jest.fn()}
      onOpenSavedRecordings={jest.fn()}
    />,
  );
  await fireEvent.press(await screen.findByTestId('recording-consent'));
  await fireEvent.press(screen.getByTestId('recording-microphone-control'));
  await fireEvent.press(screen.getByTestId('recording-microphone-control'));
  expect(service.saveSource).toHaveBeenCalledWith(completed);
  expect(bindAutomaticRecordingVisit).toHaveBeenCalledWith(completed.id, null);
});

test('leaving during appointment lookup never starts a microphone on the old screen', async () => {
  const { service } = createService();
  const view = await render(
    <RecordingScreen
      service={service}
      onBack={jest.fn()}
      onOpenSavedRecordings={jest.fn()}
    />,
  );
  jest
    .mocked(selectRecordingVisitWithinDeadline)
    .mockImplementationOnce(async () => {
      await view.unmount();
      return visit;
    });
  await fireEvent.press(await screen.findByTestId('recording-consent'));
  await fireEvent.press(screen.getByTestId('recording-microphone-control'));
  expect(service.start).not.toHaveBeenCalled();
});
