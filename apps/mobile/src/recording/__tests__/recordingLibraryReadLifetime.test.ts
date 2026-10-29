import { act, renderHook } from '@testing-library/react-native';
import { useRecordingLibraryReadState } from '../useRecordingLibraryReadState';
import type {
  RecordingLibraryService,
  RecordingLibrarySummary,
} from '../recordingLibraryService';
import { savedSource } from '../recordingScreenSupport';

function pendingRead() {
  let resolve!: (rows: readonly RecordingLibrarySummary[]) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<readonly RecordingLibrarySummary[]>(
    (done, fail) => {
      resolve = done;
      reject = fail;
    },
  );
  return { promise, resolve, reject };
}
const rows: readonly RecordingLibrarySummary[] = [
  {
    source: savedSource,
    durationMs: 2000,
    transcriptReviewState: 'unreviewed',
  },
];
function service(
  listSummaries: RecordingLibraryService['listSummaries'],
): RecordingLibraryService {
  return {
    list: async () => [],
    listSummaries,
    deleteRecording: async () => ({ audioCleanupPending: false }),
  };
}

test.each(['replacement', 'unmount'] as const)(
  'a recovery read cannot publish or mark publication after service %s',
  async transition => {
    const recovery = pendingRead();
    const onReconciled = jest.fn();
    const original = service(
      jest
        .fn()
        .mockResolvedValueOnce(rows)
        .mockImplementationOnce(() => recovery.promise),
    );
    const replacement = service(async () => []);
    const view = await renderHook(
      ({ current }: { current: RecordingLibraryService }) =>
        useRecordingLibraryReadState({
          service: current,
          automaticTranscription: null,
          onReconciled,
        }),
      { initialProps: { current: original } },
    );
    const mark = jest.spyOn(
      view.result.current.deletionTiming,
      'markListSummaryRefresh',
    );
    let refresh!: Promise<boolean>;
    await act(async () => {
      refresh = view.result.current.refreshAfterDelete(savedSource.id);
    });
    if (transition === 'replacement')
      await view.rerender({ current: replacement });
    else await view.unmount();
    const publications = onReconciled.mock.calls.length;
    await act(async () => {
      recovery.resolve(rows);
      await refresh;
    });
    expect(await refresh).toBe(false);
    expect(mark).not.toHaveBeenCalled();
    expect(onReconciled).toHaveBeenCalledTimes(publications);
    if (transition === 'replacement')
      expect(view.result.current.recordings).toEqual([]);
  },
);

test('a newer failed read retains committed rows and an older success cannot clear its error or loading ownership', async () => {
  const older = pendingRead();
  const newer = pendingRead();
  const listSummaries = jest
    .fn()
    .mockResolvedValueOnce(rows)
    .mockImplementationOnce(() => older.promise)
    .mockImplementationOnce(() => newer.promise);
  const current = service(listSummaries);
  const onReconciled = jest.fn();
  const view = await renderHook(
    ({ refreshKey }: { refreshKey: string }) =>
      useRecordingLibraryReadState({
        service: current,
        automaticTranscription: null,
        refreshKey,
        onReconciled,
      }),
    { initialProps: { refreshKey: 'before' } },
  );
  let refresh!: Promise<boolean>;
  await act(async () => {
    refresh = view.result.current.refreshAfterDelete(savedSource.id);
  });
  await view.rerender({ refreshKey: 'after' });
  await act(async () => {
    older.resolve([]);
    await refresh;
  });
  expect(view.result.current.loading).toBe(true);
  await act(async () => {
    newer.reject(new Error('latest read failed'));
  });
  expect(view.result.current.recordings).toEqual(rows);
  expect(view.result.current.loadError).toBe(true);
  expect(view.result.current.loading).toBe(false);
  expect(onReconciled).toHaveBeenCalledTimes(1);
});

test('an older recovery error cannot replace a newer successful effect state', async () => {
  const older = pendingRead();
  const listSummaries = jest
    .fn()
    .mockResolvedValueOnce(rows)
    .mockImplementationOnce(() => older.promise)
    .mockResolvedValueOnce([]);
  const current = service(listSummaries);
  const onReconciled = jest.fn();
  const view = await renderHook(
    ({ refreshKey }: { refreshKey: string }) =>
      useRecordingLibraryReadState({
        service: current,
        automaticTranscription: null,
        refreshKey,
        onReconciled,
      }),
    { initialProps: { refreshKey: 'before' } },
  );
  let refresh!: Promise<boolean>;
  await act(async () => {
    refresh = view.result.current.refreshAfterDelete(savedSource.id);
  });
  await view.rerender({ refreshKey: 'after' });
  await act(async () => {
    older.reject(new Error('superseded read failed'));
    await refresh;
  });
  expect(view.result.current.recordings).toEqual([]);
  expect(view.result.current.loadError).toBe(false);
  expect(view.result.current.loading).toBe(false);
});
