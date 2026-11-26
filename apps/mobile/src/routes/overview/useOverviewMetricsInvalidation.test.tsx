import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useIsFocused } from '@react-navigation/native';
import { AppState, type AppStateStatus } from 'react-native';
import { notifyWorkoutImportCommitted } from '../../healthkit/workoutImportEvents';
import {
  notifyLocalDataCleared,
  notifyLocalSourceDeleted,
} from '../../storage/localDataClearEvents';
import { loadOverviewMetrics } from './metricLoader';
import type { OverviewMetricProjection } from './metricProjection';
import { useOverviewMetrics } from './useOverviewMetrics';

jest.mock('@react-navigation/native', () => ({ useIsFocused: jest.fn() }));
jest.mock('../../storage/secureDatabase', () => ({
  openLocalStorage: async () => ({
    getSyncCheckpoint: async () => null,
    transaction: async (operation: (writer: unknown) => Promise<void>) =>
      operation({ putSyncCheckpoint: async () => undefined }),
  }),
  openLocalAgentMemoryDatabase: async () => ({}),
}));
jest.mock('./metricLoader', () => ({
  loadOverviewMetrics: jest.fn(async () => ({
    metrics: {},
    quantityTruncated: false,
  })),
}));
jest.mock('./selectedOverviewSnapshot', () =>
  jest.requireActual('../testSupport/overviewSnapshotMock').snapshotMock(),
);
const mockedUseIsFocused = jest.mocked(useIsFocused);

beforeEach(() => {
  jest.clearAllMocks();
  mockedUseIsFocused.mockReturnValue(true);
});

const metric: OverviewMetricProjection = {
  metric: 'steps',
  unit: 'count',
  source: 'Synthetic Watch App',
  measuredAt: '2026-10-14T10:00:00Z',
  timeZone: 'Asia/Seoul',
  latest: { date: '2026-10-14', value: 500 },
  days: [{ date: '2026-10-14', value: 500, partial: false }],
  comparison: null,
};
const snapshot = { metrics: { steps: metric }, quantityTruncated: false };
type LoadResult = Awaited<ReturnType<typeof loadOverviewMetrics>>;

test.each([
  { event: 'local data clear', invalidate: notifyLocalDataCleared },
  { event: 'source deletion', invalidate: notifyLocalSourceDeleted },
])(
  '$event clears immediately and ignores a read that started before invalidation',
  async ({ invalidate }) => {
    const appStateSubscription = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation(() => ({ remove: jest.fn() }));
    let finishOldRead!: (result: LoadResult) => void;
    const oldRead = new Promise<LoadResult>(resolve => {
      finishOldRead = resolve;
    });
    let failCurrentRead!: (error: Error) => void;
    const invalidatedRead = new Promise<LoadResult>((_resolve, reject) => {
      failCurrentRead = reject;
    });
    jest
      .mocked(loadOverviewMetrics)
      .mockReset()
      .mockResolvedValueOnce(snapshot)
      .mockReturnValueOnce(oldRead)
      .mockReturnValueOnce(invalidatedRead);

    const hook = await renderHook(() => useOverviewMetrics());
    await waitFor(() => expect(hook.result.current.state).toBe('ready'));
    expect(hook.result.current.metrics.steps).toEqual(metric);

    await act(async () => hook.result.current.retry());
    await waitFor(() => expect(loadOverviewMetrics).toHaveBeenCalledTimes(2));
    expect(hook.result.current.state).toBe('refreshing');
    expect(hook.result.current.metrics.steps).toEqual(metric);

    await act(async () => invalidate());
    expect(hook.result.current.metrics).toEqual({});
    expect(hook.result.current.state).toBe('loading');
    await waitFor(() => expect(loadOverviewMetrics).toHaveBeenCalledTimes(3));

    // An older read cannot restore the snapshot after a committed privacy event.
    await act(async () =>
      finishOldRead({ metrics: { steps: metric }, quantityTruncated: false }),
    );
    expect(hook.result.current.metrics).toEqual({});

    await act(async () => failCurrentRead(new Error('storage unavailable')));
    await waitFor(() => expect(hook.result.current.state).toBe('failed'));
    expect(hook.result.current.metrics).toEqual({});

    await hook.unmount();
    appStateSubscription.mockRestore();
  },
);

test('clears metrics on return while Home is unfocused and waits for focus to re-read', async () => {
  let callback: ((state: AppStateStatus) => void) | undefined;
  const appStateSubscription = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, listener) => {
      callback = listener;
      return { remove: jest.fn() };
    });
  let failRead!: (error: Error) => void;
  const failedRead = new Promise<LoadResult>((_resolve, reject) => {
    failRead = reject;
  });
  jest
    .mocked(loadOverviewMetrics)
    .mockReset()
    .mockResolvedValueOnce(snapshot)
    .mockReturnValueOnce(failedRead);

  const hook = await renderHook(() => useOverviewMetrics());
  await waitFor(() => expect(hook.result.current.state).toBe('ready'));
  expect(hook.result.current.metrics.steps).toEqual(metric);

  mockedUseIsFocused.mockReturnValue(false);
  await hook.rerender(undefined);
  await act(async () => {
    callback?.('background');
    callback?.('active');
  });
  expect(hook.result.current.metrics).toEqual({});
  expect(hook.result.current.state).toBe('loading');
  expect(loadOverviewMetrics).toHaveBeenCalledTimes(1);

  mockedUseIsFocused.mockReturnValue(true);
  await hook.rerender(undefined);
  await waitFor(() => expect(loadOverviewMetrics).toHaveBeenCalledTimes(2));

  // The mocked failure models a local read that cannot revalidate after settings changed.
  await act(async () =>
    failRead(new Error('source unavailable after permission change')),
  );
  await waitFor(() => expect(hook.result.current.state).toBe('failed'));
  expect(hook.result.current.metrics).toEqual({});

  await hook.unmount();
  appStateSubscription.mockRestore();
});

test('committed workouts refresh focused Overview and coalesce while its read is held', async () => {
  const previous = AppState.currentState;
  AppState.currentState = 'active';
  const subscription = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation(() => ({ remove: jest.fn() }));
  const workout = (day: string) => ({
    metrics: {
      workouts: {
        ...metric,
        metric: 'workouts' as const,
        latest: { date: day, value: 42 },
        unit: 'min',
      },
    },
    quantityTruncated: false,
  });
  let settle!: (value: LoadResult) => void;
  const held = new Promise<LoadResult>(resolve => {
    settle = resolve;
  });
  jest
    .mocked(loadOverviewMetrics)
    .mockReset()
    .mockResolvedValueOnce(workout('2026-10-14'))
    .mockReturnValueOnce(held)
    .mockResolvedValueOnce(workout('2026-10-16'));
  const hook = await renderHook(() => useOverviewMetrics());
  try {
    await waitFor(() => expect(hook.result.current.state).toBe('ready'));
    await act(async () => notifyWorkoutImportCommitted());
    await waitFor(() => expect(loadOverviewMetrics).toHaveBeenCalledTimes(2));
    await act(async () => {
      notifyWorkoutImportCommitted();
      notifyWorkoutImportCommitted();
    });
    expect(loadOverviewMetrics).toHaveBeenCalledTimes(2);
    expect(hook.result.current.metrics.workouts?.latest.date).toBe(
      '2026-10-14',
    );

    await act(async () => settle(workout('2026-10-15')));
    await waitFor(() =>
      expect(hook.result.current.metrics.workouts?.latest.date).toBe(
        '2026-10-16',
      ),
    );
    expect(loadOverviewMetrics).toHaveBeenCalledTimes(3);

    AppState.currentState = 'background';
    await act(async () => notifyWorkoutImportCommitted());
    expect(loadOverviewMetrics).toHaveBeenCalledTimes(3);
    AppState.currentState = 'active';
    mockedUseIsFocused.mockReturnValue(false);
    await hook.rerender(undefined);
    await act(async () => notifyWorkoutImportCommitted());
    expect(loadOverviewMetrics).toHaveBeenCalledTimes(3);
  } finally {
    settle(workout('2026-10-15'));
    await hook.unmount();
    AppState.currentState = previous;
    subscription.mockRestore();
  }
});
