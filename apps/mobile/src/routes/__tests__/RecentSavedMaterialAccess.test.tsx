import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import type { RecentMaterialRow } from '../../generatedReports/catalog';
import { notifyLocalSourceDeleted } from '../../storage/localDataClearEvents';
import { useAppRootTab } from '../useAppRootTab';
import { useRecentSavedMaterial } from '../useRecentSavedMaterial';

jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));
const row: RecentMaterialRow = {
  key: 'memory:synthetic',
  id: 'manual-history:synthetic',
  origin: 'memory',
  createdAt: '2026-11-22T10:00:00.000Z',
};

test('rejects a held protected row selection and old callback after deletion before React commits', async () => {
  AppState.currentState = 'active';
  const available = jest.fn(async () => true);
  jest.mocked(conversationExecutionNative).mockReturnValue({
    bridgeAvailable: true,
    protectedDataAvailable: available,
    subscribe: jest.fn(() => jest.fn()),
    currentPhase: () => 'active',
    begin: jest.fn(),
    end: jest.fn(),
    isActive: jest.fn(),
  });
  const list = jest.fn().mockResolvedValueOnce([row]).mockResolvedValue([]);
  const { result } = await renderHook(() =>
    useRecentSavedMaterial(true, undefined, list),
  );
  expect(result.current.rows).toEqual([row]);

  let finish!: (value: boolean) => void;
  available.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  const select = jest.fn();
  const oldOpen = result.current.open;
  const opening = oldOpen(row, select);
  await act(async () => {
    notifyLocalSourceDeleted();
    finish(true);
    await opening;
    await oldOpen(row, select);
  });
  expect(select).not.toHaveBeenCalled();
  expect(result.current.rows).toEqual([]);
});

test('does not query a warmed database without a positive protected-data witness', async () => {
  AppState.currentState = 'active';
  jest.mocked(conversationExecutionNative).mockReturnValue({
    bridgeAvailable: true,
    protectedDataAvailable: async () => false,
    subscribe: jest.fn(() => jest.fn()),
    currentPhase: () => 'active',
    begin: jest.fn(),
    end: jest.fn(),
    isActive: jest.fn(),
  });
  const list = jest.fn(async () => [row]);
  const { result } = await renderHook(() =>
    useRecentSavedMaterial(true, undefined, list),
  );
  expect(list).not.toHaveBeenCalled();
  expect(result.current.rows).toEqual([]);
  expect(result.current.state).toBe('failed');
});

test('a native denial while paging clears earlier rows even without a lock event', async () => {
  AppState.currentState = 'active';
  const available = jest.fn(async () => true);
  jest.mocked(conversationExecutionNative).mockReturnValue({
    bridgeAvailable: true,
    protectedDataAvailable: available,
    subscribe: jest.fn(() => jest.fn()),
    currentPhase: () => 'active',
    begin: jest.fn(),
    end: jest.fn(),
    isActive: jest.fn(),
  });
  const list = jest.fn(async () => [row]);
  const { result } = await renderHook(() =>
    useRecentSavedMaterial(true, undefined, list, true),
  );
  expect(result.current.rows).toEqual([row]);
  available.mockRejectedValueOnce(new Error('synthetic native failure'));
  await act(async () => {
    expect(await result.current.loadMore()).toBe(false);
  });
  expect(list).toHaveBeenCalledTimes(1);
  expect(result.current.rows).toEqual([]);
  expect(result.current.state).toBe('failed');
});

test('an unmounted Records root cannot use a callback even if its shared stack key stays current', async () => {
  AppState.currentState = 'active';
  const available = jest.fn(async () => true);
  jest.mocked(conversationExecutionNative).mockReturnValue({
    bridgeAvailable: true,
    protectedDataAvailable: available,
    subscribe: jest.fn(() => jest.fn()),
    currentPhase: () => 'active',
    begin: jest.fn(),
    end: jest.fn(),
    isActive: jest.fn(),
  });
  const list = jest.fn(async () => [row]);
  const unchangedStackOwner = {
    isCurrent: () => true,
    subscribe: () => () => {},
  };
  const { result, unmount } = await renderHook(() =>
    useRecentSavedMaterial(true, unchangedStackOwner, list, true),
  );
  expect(result.current.rows).toEqual([row]);
  const { isRouteCurrent, open } = result.current;
  expect(isRouteCurrent()).toBe(true);
  await unmount();
  expect(isRouteCurrent()).toBe(false);
  const select = jest.fn();
  await open(row, select);
  expect(select).not.toHaveBeenCalled();
  expect(available).toHaveBeenCalledTimes(2);
});

test.each(['schedule', 'records'] as const)(
  'a held action cannot cross a synchronous tab switch ending in %s, even with the same stack key',
  async finalTab => {
    AppState.currentState = 'active';
    const available = jest.fn(async () => true);
    jest.mocked(conversationExecutionNative).mockReturnValue({
      bridgeAvailable: true,
      protectedDataAvailable: available,
      subscribe: jest.fn(() => jest.fn()),
      currentPhase: () => 'active',
      begin: jest.fn(),
      end: jest.fn(),
      isActive: jest.fn(),
    });
    const list = jest.fn().mockResolvedValueOnce([row]).mockResolvedValue([]);
    const owner = { isCurrent: () => true, subscribe: () => () => {} };
    const { result } = await renderHook(() => {
      const rootTab = useAppRootTab();
      return {
        rootTab,
        feed: useRecentSavedMaterial(
          true,
          owner,
          list,
          true,
          true,
          rootTab.recordsTabAuthority,
        ),
      };
    });
    await act(async () => {
      result.current.rootTab.selectActiveTab('records');
    });
    expect(result.current.feed.rows).toEqual([row]);
    let release!: (value: boolean) => void;
    available.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          release = resolve;
        }),
    );
    const select = jest.fn();
    const lastRender = result.current.feed;
    const held = lastRender.open(row, select);
    await act(async () => {
      result.current.rootTab.selectActiveTab('schedule');
      result.current.rootTab.selectActiveTab(finalTab);
      // No React render or native transition has run yet; the stack owner is unchanged.
      expect(owner.isCurrent()).toBe(true);
      expect(lastRender.isRouteCurrent()).toBe(false);
      release(true);
      await held;
      await lastRender.open(row, select);
    });
    expect(select).not.toHaveBeenCalled();
    expect(result.current.feed.rows).toEqual([]);
  },
);

test('a held catalog result from the previous Records epoch never repopulates the current page', async () => {
  AppState.currentState = 'active';
  jest.mocked(conversationExecutionNative).mockReturnValue({
    bridgeAvailable: true,
    protectedDataAvailable: async () => true,
    subscribe: jest.fn(() => jest.fn()),
    currentPhase: () => 'active',
    begin: jest.fn(),
    end: jest.fn(),
    isActive: jest.fn(),
  });
  let release!: (value: RecentMaterialRow[]) => void;
  const pending = new Promise<RecentMaterialRow[]>(resolve => {
    release = resolve;
  });
  const list = jest.fn().mockReturnValueOnce(pending).mockResolvedValue([]);
  const owner = { isCurrent: () => true, subscribe: () => () => {} };
  const { result } = await renderHook(() => {
    const tab = useAppRootTab();
    return {
      tab,
      feed: useRecentSavedMaterial(
        true,
        owner,
        list,
        true,
        true,
        tab.recordsTabAuthority,
      ),
    };
  });
  await act(async () => {
    result.current.tab.selectActiveTab('records');
  });
  expect(list).toHaveReturnedWith(pending);
  await act(async () => {
    result.current.tab.selectActiveTab('schedule');
    result.current.tab.selectActiveTab('records');
    release([row]);
  });
  expect(list).toHaveBeenCalledTimes(2);
  expect(result.current.feed.rows).toEqual([]);
});
