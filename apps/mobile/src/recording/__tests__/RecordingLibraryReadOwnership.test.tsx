import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import RecordingLibraryPanel from '../RecordingLibraryPanel';
import type {
  RecordingLibraryService,
  RecordingLibrarySummary,
} from '../recordingLibraryService';
import { savedSource } from '../recordingScreenSupport';
import {
  confirmNativeDeletion,
  mockNativeDeletionAlert,
} from '../testSupport/nativeDeletionAlert';

const deleted = {
  ...savedSource,
  id: 'deleted-recording',
  title: 'Deleted recording',
};
const retained = {
  ...savedSource,
  id: 'retained-recording',
  title: 'Older title',
};
const fresh = { ...retained, title: 'Corrected title' };
const removedElsewhere = {
  ...savedSource,
  id: 'externally-removed',
  title: 'Removed from storage',
};
const summary = (source: typeof savedSource): RecordingLibrarySummary => ({
  source,
  durationMs: 2000,
  transcriptReviewState: 'unreviewed',
});

function pendingRead() {
  let resolve!: (rows: readonly RecordingLibrarySummary[]) => void;
  const promise = new Promise<readonly RecordingLibrarySummary[]>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

test('a late cleanup refresh cannot overwrite a newer effect result or revive an externally deleted row', async () => {
  const alert = mockNativeDeletionAlert();
  const older = pendingRead();
  const newer = pendingRead();
  const listSummaries = jest
    .fn()
    .mockResolvedValueOnce([
      summary(deleted),
      summary(retained),
      summary(removedElsewhere),
    ])
    .mockImplementationOnce(() => older.promise)
    .mockImplementationOnce(() => newer.promise);
  const service: RecordingLibraryService = {
    list: async () => [],
    listSummaries,
    deleteRecording: async () => ({ audioCleanupPending: true }),
  };
  const view = await render(
    <RecordingLibraryPanel
      service={service}
      refreshKey="before"
      selectedSummarySourceId={removedElsewhere.id}
    />,
  );
  try {
    await screen.findByTestId(`recording-delete-${deleted.id}`);
    await fireEvent.press(screen.getByTestId(`recording-delete-${deleted.id}`));
    await confirmNativeDeletion(alert);
    await waitFor(() => expect(listSummaries).toHaveBeenCalledTimes(2));
    await view.rerender(
      <RecordingLibraryPanel
        service={service}
        refreshKey="after"
        selectedSummarySourceId={removedElsewhere.id}
      />,
    );
    await waitFor(() => expect(listSummaries).toHaveBeenCalledTimes(3));
    await act(async () => {
      newer.resolve([summary(fresh)]);
    });
    expect(screen.getByText('Corrected title')).toBeTruthy();
    await act(async () => {
      older.resolve([
        summary(deleted),
        summary(retained),
        summary(removedElsewhere),
      ]);
    });
    expect({
      fresh: screen.queryByText('Corrected title') !== null,
      old: screen.queryByText('Older title') !== null,
      externalRow:
        screen.queryByTestId(
          `recording-library-item-${removedElsewhere.id}`,
        ) !== null,
      selection:
        screen.queryByTestId('saved-recordings-selection-summary') !== null,
    }).toEqual({
      fresh: true,
      old: false,
      externalRow: false,
      selection: false,
    });
    expect(
      screen.queryByTestId(`recording-library-item-${deleted.id}`),
    ).toBeNull();
  } finally {
    await act(async () => {
      older.resolve([]);
      newer.resolve([]);
    });
    alert.mockRestore();
  }
});

test('an older effect result cannot replace a newer requested snapshot', async () => {
  const older = pendingRead();
  const newer = pendingRead();
  const listSummaries = jest
    .fn()
    .mockImplementationOnce(() => older.promise)
    .mockImplementationOnce(() => newer.promise);
  const service: RecordingLibraryService = {
    list: async () => [],
    listSummaries,
    deleteRecording: async () => ({ audioCleanupPending: false }),
  };
  const view = await render(
    <RecordingLibraryPanel service={service} refreshKey="before" />,
  );
  try {
    await view.rerender(
      <RecordingLibraryPanel service={service} refreshKey="after" />,
    );
    await act(async () => {
      newer.resolve([summary(fresh)]);
    });
    await act(async () => {
      older.resolve([summary(retained)]);
    });
    expect(screen.getByText('Corrected title')).toBeTruthy();
    expect(screen.queryByText('Older title')).toBeNull();
  } finally {
    await act(async () => {
      older.resolve([]);
      newer.resolve([]);
    });
  }
});
