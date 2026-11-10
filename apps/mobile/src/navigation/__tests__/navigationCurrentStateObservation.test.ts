import {
  captureNavigationTestSnapshot,
  readNavigationTestState,
  registerNavigationTestObserver,
  registerNavigationTestStateReader,
} from '../navigationTestObservation';

test('reads current stack state and rejects missing or multiple readers', () => {
  const first = {
    logicalKeys: ['root'],
    currentRouteKey: 'root',
    currentRouteName: 'home',
    ready: true,
    nativeKeys: ['root'],
  };
  let current = first;
  expect(readNavigationTestState().status).toBe('unavailable');
  const stop = registerNavigationTestObserver(jest.fn());
  expect(readNavigationTestState().status).toBe('unavailable');
  const reader = registerNavigationTestStateReader(() => current);
  expect(readNavigationTestState()).toMatchObject({
    status: 'single',
    state: first,
  });
  current = {
    ...first,
    logicalKeys: ['root', 'source'],
    currentRouteKey: 'source',
    currentRouteName: 'source-detail',
    nativeKeys: ['root'],
  };
  expect(readNavigationTestState()).toMatchObject({
    status: 'single',
    state: current,
  });
  const other = registerNavigationTestStateReader(() => first);
  expect(readNavigationTestState().status).toBe('ambiguous');
  other.unregister();
  current = first;
  expect(readNavigationTestState()).toMatchObject({
    status: 'single',
    state: first,
  });
  reader.unregister();
  expect(readNavigationTestState().status).toBe('unavailable');
  stop();
});

test('marks changes while the native snapshot is in flight instead of joining mismatched samples', async () => {
  const stop = registerNavigationTestObserver(jest.fn());
  let key = 'root';
  const reader = registerNavigationTestStateReader(() => ({
    logicalKeys: [key],
    currentRouteKey: key,
    currentRouteName: 'conversation',
    ready: true,
    nativeKeys: [key],
  }));
  const stable = await captureNavigationTestSnapshot(async () => ({
    observerID: 'test',
  }));
  expect(stable.routeState.status).toBe('consistent');
  const changed = await captureNavigationTestSnapshot(async () => {
    key = 'source';
    return { observerID: 'test' };
  });
  expect(changed.routeState.status).toBe('changed');
  reader.unregister();
  stop();
});

test('does not register without an observer and removes readers when the observer stops', () => {
  const state = {
    logicalKeys: ['a'],
    currentRouteKey: 'a',
    currentRouteName: 'home',
    ready: true,
    nativeKeys: ['a'],
  };
  const inert = registerNavigationTestStateReader(() => state);
  expect(inert.stackID).toBeNull();
  const stop = registerNavigationTestObserver(jest.fn());
  expect(readNavigationTestState().status).toBe('unavailable');
  const reader = registerNavigationTestStateReader(() => state);
  expect(reader.stackID).not.toBeNull();
  stop();
  const stopAgain = registerNavigationTestObserver(jest.fn());
  expect(readNavigationTestState().status).toBe('unavailable');
  reader.unregister();
  stopAgain();
});

test('rejects a different stack registered while the native sample is in flight', async () => {
  const stop = registerNavigationTestObserver(jest.fn());
  const state = {
    logicalKeys: ['a'],
    currentRouteKey: 'a',
    currentRouteName: 'home',
    ready: true,
    nativeKeys: ['a'],
  };
  const first = registerNavigationTestStateReader(() => state);
  let second: ReturnType<typeof registerNavigationTestStateReader> | undefined;
  const sample = await captureNavigationTestSnapshot(async () => {
    first.unregister();
    second = registerNavigationTestStateReader(() => state);
    return {};
  });
  expect(sample.routeState.status).toBe('changed');
  second?.unregister();
  stop();
});
