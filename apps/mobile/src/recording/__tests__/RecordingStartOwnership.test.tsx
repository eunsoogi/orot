import { act, fireEvent, render, screen } from '@testing-library/react-native';
import RecordingScreen from '../RecordingScreen';
import { completed, createService } from '../recordingScreenSupport';
import type { RecordingSnapshot } from '../recordingTypes';

jest.mock('../bindAutomaticRecordingVisit', () => ({
  bindAutomaticRecordingVisit: jest.fn(async () => {}),
  selectRecordingVisitWithinDeadline: jest.fn(async () => null),
}));
jest.mock('../nativeRecordingBridge', () => ({
  nativeRecordingBridge: {},
  isSyntheticRecordingProbeAvailable: jest.fn(() => false),
}));
// A synchronous test control starts the real screen operation without awaiting native completion.
jest.mock('../RecordingControls', () => {
  const { Button, Text, View } = require('react-native');
  return function Controls(props: {
    onStart: () => Promise<void>;
    status: string;
  }) {
    return (
      <View>
        <Button
          title="start synthetic take"
          onPress={() => {
            props.onStart();
          }}
        />
        <Text>{props.status}</Text>
      </View>
    );
  };
});

test('ignores a late native start result after the service generation changes', async () => {
  const original = createService().service;
  const replacement = createService().service;
  let finish!: (snapshot: RecordingSnapshot) => void;
  const pending = new Promise<RecordingSnapshot>(resolve => {
    finish = resolve;
  });
  jest.mocked(original.start).mockReturnValueOnce(pending);
  const props = { onBack: jest.fn() };
  const view = await render(<RecordingScreen {...props} service={original} />);
  await fireEvent.press(screen.getByText('start synthetic take'));
  expect(original.start).toHaveBeenCalledTimes(1);
  await view.rerender(<RecordingScreen {...props} service={replacement} />);
  expect(screen.getByText('idle')).toBeTruthy();
  await act(async () => {
    finish({
      status: 'recording',
      id: completed.id,
      durationMs: 5000,
      consentAcknowledged: true,
    });
    await pending;
  });
  expect(screen.getByText('idle')).toBeTruthy();
  expect(screen.queryByText('recording')).toBeNull();
  expect(replacement.start).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText('start synthetic take'));
  expect(replacement.start).toHaveBeenCalledTimes(1);
  expect(screen.getByText('recording')).toBeTruthy();
});
