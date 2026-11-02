import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { loadHomeMetrics } from './metricLoader';
import { useHomeMetrics } from './useHomeMetrics';

jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('../../storage/secureDatabase', () => ({
  openLocalStorage: async () => ({
    getSyncCheckpoint: async () => null,
    transaction: async (operation: (writer: unknown) => Promise<void>) =>
      operation({ putSyncCheckpoint: async () => undefined }),
  }),
  openLocalAgentMemoryDatabase: async () => ({}),
}));
jest.mock('./metricLoader', () => ({
  loadHomeMetrics: jest.fn(async () => ({
    metrics: {},
    quantityTruncated: false,
  })),
}));

test('refreshes the local window when the app returns to the foreground', async () => {
  jest.clearAllMocks();
  let callback: ((state: AppStateStatus) => void) | undefined;
  const subscription = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, listener) => {
      callback = listener;
      return { remove: jest.fn() };
    });
  const hook = await renderHook(() => useHomeMetrics());
  await waitFor(() => expect(hook.result.current.state).toBe('ready'));
  expect(loadHomeMetrics).toHaveBeenCalledTimes(1);
  await act(async () => callback?.('active'));
  await waitFor(() => expect(loadHomeMetrics).toHaveBeenCalledTimes(2));
  await hook.unmount();
  subscription.mockRestore();
});

test('does not let an older refresh overwrite a later saved selection', async () => {
  jest.clearAllMocks();
  let callback: ((state: AppStateStatus) => void) | undefined;
  const subscription = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, listener) => {
      callback = listener;
      return { remove: jest.fn() };
    });
  let finish!: (result: Awaited<ReturnType<typeof loadHomeMetrics>>) => void;
  const pending = new Promise<Awaited<ReturnType<typeof loadHomeMetrics>>>(
    resolve => {
      finish = resolve;
    },
  );
  jest
    .mocked(loadHomeMetrics)
    .mockResolvedValueOnce({ metrics: {}, quantityTruncated: false })
    .mockReturnValueOnce(pending);
  const hook = await renderHook(() => useHomeMetrics());
  await waitFor(() => expect(hook.result.current.state).toBe('ready'));
  await act(async () => callback?.('active'));
  await waitFor(() => expect(loadHomeMetrics).toHaveBeenCalledTimes(2));
  await act(async () => hook.result.current.save(['steps', 'sleep']));
  await act(async () => finish({ metrics: {}, quantityTruncated: false }));
  expect(hook.result.current.selection).toEqual(['steps', 'sleep']);
  await hook.unmount();
  subscription.mockRestore();
});
