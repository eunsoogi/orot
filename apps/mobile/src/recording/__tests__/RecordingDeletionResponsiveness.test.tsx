import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import RecordingLibraryPanel from '../RecordingLibraryPanel';
import { RecordingDeletionTimingContext } from '../recordingDeletionTiming';
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

test('marks confirmation, visible progress and committed row refresh in order', async () => {
  const alert = mockNativeDeletionAlert();
  let resolveDeletion:
    ((result: { readonly audioCleanupPending: boolean }) => void) | undefined;
  const service = {
    list: jest.fn(async () => [savedSource]),
    deleteRecording: jest.fn(
      () =>
        new Promise<{ readonly audioCleanupPending: boolean }>(resolve => {
          resolveDeletion = resolve;
        }),
    ),
  };
  const probe = {
    mark: jest.fn(),
    begin: jest.fn(),
    end: jest.fn(),
    finish: jest.fn(),
  };

  await render(
    <RecordingDeletionTimingContext.Provider value={probe}>
      <RecordingLibraryPanel service={service} />
    </RecordingDeletionTimingContext.Provider>,
  );
  await screen.findByTestId(`recording-delete-${savedSource.id}`);
  await fireEvent.press(
    screen.getByTestId(`recording-delete-${savedSource.id}`),
  );
  await confirmNativeDeletion(alert);

  expect(probe.mark).toHaveBeenCalledWith('confirmation-tap');
  const progress = await screen.findByTestId('recording-delete-progress');
  fireEvent(progress, 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 120, height: 28 } },
  });
  fireEvent(progress, 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 120, height: 28 } },
  });
  await waitFor(() => {
    expect(probe.mark).toHaveBeenCalledWith('progress-presented');
  });
  await act(async () => {
    resolveDeletion?.({ audioCleanupPending: false });
  });
  await waitFor(() => {
    expect(
      screen.queryByTestId(`recording-library-item-${savedSource.id}`),
    ).toBeNull();
    expect(probe.mark).toHaveBeenCalledWith('list-refresh');
  });
  expect(probe.mark.mock.calls).toEqual([
    ['confirmation-tap'],
    ['progress-presented'],
    ['list-refresh'],
  ]);
  alert.mockRestore();
});
