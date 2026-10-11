import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import RecordingLibraryPanel from '../RecordingLibraryPanel';
import { savedSource } from '../recordingScreenSupport';
import {
  confirmNativeDeletion,
  mockNativeDeletionAlert,
} from '../testSupport/nativeDeletionAlert';

test('removes a committed row and releases controls before a slow summary refresh', async () => {
  const alert = mockNativeDeletionAlert();
  const onBusyChange = jest.fn();
  const list = jest
    .fn()
    .mockResolvedValueOnce([savedSource])
    .mockImplementation(() => new Promise(() => {}));
  await render(
    <RecordingLibraryPanel
      service={{
        list,
        deleteRecording: async () => ({ audioCleanupPending: false }),
      }}
      onBusyChange={onBusyChange}
    />,
  );
  await screen.findByTestId(`recording-delete-${savedSource.id}`);
  await fireEvent.press(
    screen.getByTestId(`recording-delete-${savedSource.id}`),
  );
  await confirmNativeDeletion(alert);
  await waitFor(() =>
    expect(
      screen.queryByTestId(`recording-library-item-${savedSource.id}`),
    ).toBeNull(),
  );
  expect(onBusyChange).toHaveBeenLastCalledWith(false);
  alert.mockRestore();
});
