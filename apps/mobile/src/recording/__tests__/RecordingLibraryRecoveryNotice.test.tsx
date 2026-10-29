import { act, fireEvent, render, screen } from '@testing-library/react-native';
import RecordingLibraryPanel from '../RecordingLibraryPanel';
import { savedSource } from '../recordingScreenSupport';
import {
  confirmNativeDeletion,
  mockNativeDeletionAlert,
} from '../testSupport/nativeDeletionAlert';

test('a current reconciliation clears a superseded cleanup notice after a newer read failed', async () => {
  const alert = mockNativeDeletionAlert();
  let release!: () => void;
  const older = new Promise<readonly (typeof savedSource)[]>(resolve => {
    release = () => resolve([savedSource]);
  });
  const list = jest
    .fn()
    .mockResolvedValueOnce([savedSource])
    .mockImplementationOnce(() => older)
    .mockRejectedValueOnce(new Error('current read failed'))
    .mockResolvedValueOnce([]);
  const service = {
    list,
    deleteRecording: async () => ({ audioCleanupPending: true }),
  };
  const view = await render(
    <RecordingLibraryPanel service={service} refreshKey="before" />,
  );
  try {
    await screen.findByTestId(`recording-delete-${savedSource.id}`);
    await fireEvent.press(
      screen.getByTestId(`recording-delete-${savedSource.id}`),
    );
    await confirmNativeDeletion(alert);
    expect(screen.getByTestId('recording-delete-cleanup-pending')).toBeTruthy();
    await view.rerender(
      <RecordingLibraryPanel service={service} refreshKey="failed" />,
    );
    expect(screen.getByTestId('recording-delete-cleanup-pending')).toBeTruthy();
    await act(async () => {
      release();
    });
    expect(screen.getByTestId('recording-delete-cleanup-pending')).toBeTruthy();
    expect(
      screen.queryByTestId(`recording-library-item-${savedSource.id}`),
    ).toBeNull();
    await view.rerender(
      <RecordingLibraryPanel service={service} refreshKey="recovered" />,
    );
    expect(screen.queryByTestId('recording-delete-cleanup-pending')).toBeNull();
  } finally {
    await act(async () => {
      release();
    });
    alert.mockRestore();
  }
});

test('failed deletion retains its error and busy ownership until its recovery read settles', async () => {
  const alert = mockNativeDeletionAlert();
  const busy = jest.fn();
  let release!: () => void;
  const recovery = new Promise<readonly (typeof savedSource)[]>(resolve => {
    release = () => resolve([savedSource]);
  });
  const list = jest
    .fn()
    .mockResolvedValueOnce([savedSource])
    .mockImplementationOnce(() => recovery);
  const service = {
    list,
    deleteRecording: async () => {
      throw new Error('source cascade rolled back');
    },
  };
  await render(<RecordingLibraryPanel service={service} onBusyChange={busy} />);
  try {
    await screen.findByTestId(`recording-delete-${savedSource.id}`);
    await fireEvent.press(
      screen.getByTestId(`recording-delete-${savedSource.id}`),
    );
    await confirmNativeDeletion(alert);
    expect(screen.getByTestId('recording-delete-error')).toBeTruthy();
    expect(busy).toHaveBeenLastCalledWith(true);
    await act(async () => {
      release();
    });
    expect(busy).toHaveBeenLastCalledWith(false);
    expect(screen.getByTestId('recording-delete-error')).toBeTruthy();
    expect(
      screen.getByTestId(`recording-library-item-${savedSource.id}`),
    ).toBeTruthy();
  } finally {
    await act(async () => {
      release();
    });
    alert.mockRestore();
  }
});
