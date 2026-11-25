import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { AgentMemoryService } from '@orot/agent-memory';
import type { RecordRepository } from '@orot/storage';
import RecordingLibraryPanel from '../RecordingLibraryPanel';
import { createRecordingLibraryService } from '../recordingLibraryService';
import { savedSource } from '../recordingScreenSupport';
import {
  confirmNativeDeletion,
  mockNativeDeletionAlert,
} from '../testSupport/nativeDeletionAlert';
import { resultGate } from '../testSupport/recordingSummaryRaceHarness';

test('hides the committed row before held cleanup while the audio queue and routing remain owned', async () => {
  const alert = mockNativeDeletionAlert();
  const database = resultGate();
  const cleanup = resultGate();
  const reconcile = jest.fn(async () => {});
  const onSourceDeleted = jest.fn();
  const onBusyChange = jest.fn();
  let persisted = true;
  let queuedRead: Promise<unknown> | undefined;
  const service = createRecordingLibraryService({
    loadRepository: async () =>
      ({
        list: async () => (persisted ? [savedSource] : []),
        get: async () => (persisted ? savedSource : null),
      }) as unknown as RecordRepository,
    assertRecordingStopped: async () => {},
    openMemory: async () => ({}) as AgentMemoryService,
    removeSource: async () => {
      await database.wait();
      persisted = false;
      return { sourceDeleted: true, memoriesDeleted: 0 };
    },
    audioDeletion: {
      stage: async () => {},
      commit: cleanup.wait,
      reconcile,
      restore: async () => {
        throw new Error('Committed audio must never be restored');
      },
    },
  });

  // This fixture exercises the real deletion adapter and staged audio queue, without native storage.
  try {
    await render(
      <RecordingLibraryPanel
        service={{ ...service, listSummaries: undefined }}
        onSourceDeleted={onSourceDeleted}
        onBusyChange={onBusyChange}
      />,
    );
    const row = `recording-library-item-${savedSource.id}`;
    await fireEvent.press(
      await screen.findByTestId(`recording-delete-${savedSource.id}`),
    );
    await confirmNativeDeletion(alert);
    await database.entered;
    expect(screen.getByTestId(row)).toBeVisible();
    expect(screen.getByTestId('recording-delete-progress')).toBeVisible();
    expect(onBusyChange).toHaveBeenLastCalledWith(true);

    await act(async () => {
      database.release();
      await cleanup.entered;
    });
    expect(screen.queryByTestId(row)).toBeNull();
    expect(screen.queryByTestId('recording-delete-progress')).toBeNull();
    expect(onSourceDeleted).not.toHaveBeenCalled();
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    queuedRead = service.list();
    // While cleanup is held, queued recovery cannot prematurely restore a staged file.
    expect(reconcile).toHaveBeenCalledTimes(1);

    await act(async () => {
      cleanup.release();
      await queuedRead;
    });
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
    expect(onSourceDeleted).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenLastCalledWith([]);
    expect(screen.queryByTestId(row)).toBeNull();
  } finally {
    await act(async () => {
      database.release();
      cleanup.release();
      await queuedRead;
    });
    alert.mockRestore();
  }
});

test.each([false, true])(
  'the observer never changes cleanup recovery or reports an uncommitted source (committed: %s)',
  async committed => {
    const error = new Error('synthetic mutation failure');
    const restore = jest.fn(async () => {});
    const cleanup = jest.fn(async () => {
      throw error;
    });
    const receipt = jest.fn(() => {
      throw new Error('synthetic view observer failure');
    });
    const service = createRecordingLibraryService({
      loadRepository: async () =>
        ({
          get: async () => savedSource,
        }) as unknown as RecordRepository,
      assertRecordingStopped: async () => {},
      openMemory: async () => ({}) as AgentMemoryService,
      removeSource: async () => {
        if (!committed) throw error;
        return { sourceDeleted: true, memoriesDeleted: 0 };
      },
      audioDeletion: {
        stage: async () => {},
        commit: cleanup,
        reconcile: async () => {},
        restore,
      },
    });

    const result = service.deleteRecordingWithCommit!(savedSource.id, receipt);
    if (committed) {
      await expect(result).resolves.toEqual({ audioCleanupPending: true });
      expect(receipt).toHaveBeenCalledTimes(1);
      expect(cleanup).toHaveBeenCalledWith(savedSource.id);
      expect(restore).not.toHaveBeenCalled();
    } else {
      await expect(result).rejects.toBe(error);
      expect(receipt).not.toHaveBeenCalled();
      expect(cleanup).not.toHaveBeenCalled();
      expect(restore).toHaveBeenCalledWith(savedSource.id);
    }
  },
);
