import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { notifyWorkoutImportCommitted } from '../../healthkit/workoutImportEvents';
import { readIsolatedOverview } from '../../storage/secureDatabase';
import { loadOverviewMetrics } from './metricLoader';
import type { OverviewMetricProjection } from './metricProjection';
import { useOverviewMetrics } from './useOverviewMetrics';

let mockFocused = true;
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => mockFocused,
}));
jest.mock('../../storage/secureDatabase', () => ({
  readIsolatedOverview: jest.fn(async () => 'unavailable'),
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

test('defers a real committed workout until foreground, without speculative refresh', async () => {
  jest.clearAllMocks();
  const previous = AppState.currentState;
  let callback: ((state: AppStateStatus) => void) | undefined;
  const subscription = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, listener) => {
      callback = listener;
      return { remove: jest.fn() };
    });
  const hook = await renderHook(() => useOverviewMetrics());
  try {
    await waitFor(() => expect(hook.result.current.state).toBe('ready'));
    AppState.currentState = 'background';
    await act(async () => notifyWorkoutImportCommitted());
    expect(loadOverviewMetrics).toHaveBeenCalledTimes(1);
    AppState.currentState = 'active';
    await act(async () => callback?.('active'));
    await waitFor(() => expect(loadOverviewMetrics).toHaveBeenCalledTimes(2));
    await act(async () => callback?.('active'));
    expect(loadOverviewMetrics).toHaveBeenCalledTimes(2);
  } finally {
    AppState.currentState = previous;
    await hook.unmount();
    subscription.mockRestore();
  }
});

test('does not let an older refresh overwrite a later saved selection', async () => {
  jest.clearAllMocks();
  const subscription = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation(() => ({ remove: jest.fn() }));
  let finish!: (
    result: Awaited<ReturnType<typeof loadOverviewMetrics>>,
  ) => void;
  const pending = new Promise<Awaited<ReturnType<typeof loadOverviewMetrics>>>(
    resolve => {
      finish = resolve;
    },
  );
  jest
    .mocked(loadOverviewMetrics)
    .mockResolvedValueOnce({ metrics: {}, quantityTruncated: false })
    .mockReturnValueOnce(pending);
  const hook = await renderHook(() => useOverviewMetrics());
  await waitFor(() => expect(hook.result.current.state).toBe('ready'));
  await act(async () => hook.result.current.retry());
  await waitFor(() => expect(loadOverviewMetrics).toHaveBeenCalledTimes(2));
  await act(async () => hook.result.current.save(['steps', 'sleep']));
  await act(async () => finish({ metrics: {}, quantityTruncated: false }));
  expect(hook.result.current.selection).toEqual(['steps', 'sleep']);
  await hook.unmount();
  subscription.mockRestore();
});

test('keeps the last successful metrics visible while refreshing and after a refresh failure', async () => {
  jest.clearAllMocks();
  const subscription = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation(() => ({ remove: jest.fn() }));
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
  let fail!: (error: Error) => void;
  const pending = new Promise<Awaited<ReturnType<typeof loadOverviewMetrics>>>(
    (_resolve, reject) => {
      fail = reject;
    },
  );
  jest
    .mocked(loadOverviewMetrics)
    .mockReset()
    .mockResolvedValueOnce({
      metrics: { steps: metric },
      quantityTruncated: false,
    })
    .mockReturnValueOnce(pending);

  const hook = await renderHook(() => useOverviewMetrics());
  await waitFor(() => expect(hook.result.current.state).toBe('ready'));
  expect(hook.result.current.metrics.steps).toEqual(metric);

  await act(async () => hook.result.current.retry());
  await waitFor(() => expect(hook.result.current.state).toBe('refreshing'));
  expect(hook.result.current.metrics.steps).toEqual(metric);

  await act(async () => fail(new Error('storage unavailable')));
  await waitFor(() => expect(hook.result.current.state).toBe('stale'));
  expect(hook.result.current.metrics.steps).toEqual(metric);

  await hook.unmount();
  subscription.mockRestore();
});

test('reports a first-read failure without treating it as an empty snapshot', async () => {
  jest.clearAllMocks();
  const subscription = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation(() => ({ remove: jest.fn() }));
  jest
    .mocked(loadOverviewMetrics)
    .mockReset()
    .mockRejectedValueOnce(new Error('storage unavailable'));

  const hook = await renderHook(() => useOverviewMetrics());
  await waitFor(() => expect(hook.result.current.state).toBe('failed'));
  expect(hook.result.current.metrics).toEqual({});

  await hook.unmount();
  subscription.mockRestore();
});

test('recovers from a discarded snapshot with a fresh read on foreground return', async () => {
  const phaseBefore = AppState.currentState;
  let callback: ((state: AppStateStatus) => void) | undefined;
  const subscription = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, listener) => {
      callback = listener;
      return { remove: jest.fn() };
    });
  const read = jest
    .mocked(readIsolatedOverview)
    .mockClear()
    .mockResolvedValueOnce('unavailable')
    .mockResolvedValueOnce('discarded')
    .mockResolvedValueOnce('unavailable')
    .mockImplementationOnce(async (_now, _signal, publish) => {
      publish({
        selection: ['steps'],
        chart: { metrics: {}, quantityTruncated: false },
      });
      return 'published';
    });
  const legacy = jest.mocked(loadOverviewMetrics);
  legacy.mockResolvedValueOnce({ metrics: {}, quantityTruncated: false });
  const hook = await renderHook(() => useOverviewMetrics());
  await waitFor(() => expect(hook.result.current.state).toBe('ready'));
  legacy.mockClear();
  await act(async () => hook.result.current.retry());
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  AppState.currentState = 'background';
  await act(async () => new Promise(resolve => setTimeout(resolve, 150)));
  expect(read).toHaveBeenCalledTimes(2);
  AppState.currentState = 'active';
  await act(async () => callback?.('active'));
  await waitFor(() => expect(hook.result.current.state).toBe('ready'));
  expect(read).toHaveBeenCalledTimes(4);
  expect(legacy).not.toHaveBeenCalled();
  expect(hook.result.current.selection).toEqual(['steps']);
  await hook.unmount();
  subscription.mockRestore();
  AppState.currentState = phaseBefore;
});

test('bounds repeated rejections and does not use shared storage after losing a witness', async () => {
  const subscription = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation(() => ({ remove: jest.fn() }));
  const read = jest
    .mocked(readIsolatedOverview)
    .mockClear()
    .mockResolvedValueOnce('discarded')
    .mockResolvedValueOnce('unavailable')
    .mockResolvedValueOnce('discarded');
  const legacy = jest.mocked(loadOverviewMetrics);
  legacy.mockClear();
  const hook = await renderHook(() => useOverviewMetrics());
  await waitFor(() => expect(hook.result.current.state).toBe('failed'));
  expect(hook.result.current.metrics).toEqual({});
  expect(read).toHaveBeenCalledTimes(3);
  expect(legacy).not.toHaveBeenCalled();
  await hook.unmount();
  subscription.mockRestore();
});

test('cancels a queued recovery when the tab loses focus', async () => {
  const subscription = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation(() => ({ remove: jest.fn() }));
  const read = jest
    .mocked(readIsolatedOverview)
    .mockClear()
    .mockResolvedValueOnce('discarded');
  const hook = await renderHook(() => useOverviewMetrics());
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  mockFocused = false;
  await hook.rerender(undefined);
  await act(async () => new Promise(resolve => setTimeout(resolve, 150)));
  expect(read).toHaveBeenCalledTimes(1);
  expect(read.mock.calls[0]?.[1].aborted).toBe(true);
  await hook.unmount();
  mockFocused = true;
  subscription.mockRestore();
});
