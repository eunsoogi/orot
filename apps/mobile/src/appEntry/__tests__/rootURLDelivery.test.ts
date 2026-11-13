import { createNavigationController } from '../../navigation/navigationController';
import type { AppNavigationRoute } from '../../routes/appNavigationRoute';
import { createEntryArbiter } from '../entryArbiter';
import { createRootURLDelivery } from '../rootURLDelivery';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

test('defers exact root through a closed gate and retries acknowledgement without navigating twice', async () => {
  const controller = createNavigationController<AppNavigationRoute>('home');
  controller.registerLeaveGuard(
    controller.getSnapshot().currentRoute.key,
    async () => true,
  );
  let ready = false;
  const selectTab = jest.fn();
  const acknowledge = jest
    .fn()
    .mockRejectedValueOnce(new Error('storage'))
    .mockResolvedValue(undefined);
  const deliver = createRootURLDelivery({
    arbiter: createEntryArbiter(),
    controller,
    peek: async () => ({ id: 'delivery', destination: 'records' }),
    acknowledge,
    canEnter: () => ready,
    selectTab,
  });
  expect(await deliver()).toBe('deferred');
  expect(selectTab).not.toHaveBeenCalled();
  ready = true;
  await expect(deliver()).rejects.toThrow('storage');
  expect(selectTab).toHaveBeenCalledTimes(1);
  expect(selectTab).toHaveBeenCalledWith('records');
  expect(await deliver()).toBe('opened');
  expect(selectTab).toHaveBeenCalledTimes(1);
});

test('rechecks the gate after a delayed guard and serializes another source', async () => {
  const controller = createNavigationController<AppNavigationRoute>('home');
  const decision = deferred<boolean>();
  controller.registerLeaveGuard(
    controller.getSnapshot().currentRoute.key,
    () => decision.promise,
  );
  let ready = true;
  const arbiter = createEntryArbiter();
  const selectTab = jest.fn();
  const acknowledge = jest.fn();
  const deliver = createRootURLDelivery({
    arbiter,
    controller,
    peek: async () => ({ id: 'url', destination: 'conversation' }),
    acknowledge,
    canEnter: () => ready,
    selectTab,
  });
  const first = deliver();
  await Promise.resolve();
  await Promise.resolve();
  const second = arbiter.run(async () => 'reply');
  ready = false;
  decision.resolve(true);
  expect(await first).toBe('deferred');
  expect(await second).toBe('reply');
  expect(selectTab).not.toHaveBeenCalled();
  expect(acknowledge).not.toHaveBeenCalled();
});

test('does not discard a detail route to satisfy a root URL', async () => {
  const controller = createNavigationController<AppNavigationRoute>('home');
  controller.push('saved-recordings');
  const arbiter = createEntryArbiter();
  const selectTab = jest.fn();
  const acknowledge = jest.fn();
  const deliver = createRootURLDelivery({
    arbiter,
    controller,
    peek: async () => ({ id: 'url', destination: 'settings' }),
    acknowledge,
    canEnter: () => true,
    selectTab,
  });
  expect(await deliver()).toBe('deferred');
  expect(controller.getSnapshot().currentRoute.name).toBe('saved-recordings');
  expect(selectTab).not.toHaveBeenCalled();
  expect(acknowledge).not.toHaveBeenCalled();
});

test('an invalidated owner cannot apply or acknowledge a delayed delivery', async () => {
  const controller = createNavigationController<AppNavigationRoute>('home');
  const pending = deferred<unknown>();
  const arbiter = createEntryArbiter();
  const selectTab = jest.fn();
  const acknowledge = jest.fn();
  const deliver = createRootURLDelivery({
    arbiter,
    controller,
    peek: () => pending.promise,
    acknowledge,
    canEnter: () => true,
    selectTab,
  });
  const attempt = deliver();
  await Promise.resolve();
  arbiter.invalidate();
  pending.resolve({ id: 'url', destination: 'schedule' });
  expect(await attempt).toBe('deferred');
  expect(selectTab).not.toHaveBeenCalled();
  expect(acknowledge).not.toHaveBeenCalled();
});

test('an explicit decline is acknowledged without repeatedly prompting on acknowledgement failure', async () => {
  const controller = createNavigationController<AppNavigationRoute>('home');
  const confirm = jest.fn((_transition: unknown, decline?: () => void) => {
    decline?.();
    return false;
  });
  controller.registerLeaveGuard(
    controller.getSnapshot().currentRoute.key,
    confirm,
  );
  const selectTab = jest.fn();
  const acknowledge = jest
    .fn()
    .mockRejectedValueOnce(new Error('storage'))
    .mockResolvedValue(undefined);
  const deliver = createRootURLDelivery({
    arbiter: createEntryArbiter(),
    controller,
    peek: async () => ({ id: 'cancelled', destination: 'overview' }),
    acknowledge,
    canEnter: () => true,
    selectTab,
  });
  await expect(deliver()).rejects.toThrow('storage');
  expect(await deliver()).toBe('cancelled');
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(selectTab).not.toHaveBeenCalled();
});

test('a decline is remembered when the appearance gate closes during confirmation', async () => {
  const controller = createNavigationController<AppNavigationRoute>('home');
  const result = deferred<boolean>();
  let decline: (() => void) | undefined;
  const confirm = jest.fn((_transition: unknown, cancel?: () => void) => {
    decline = cancel;
    return result.promise;
  });
  controller.registerLeaveGuard(
    controller.getSnapshot().currentRoute.key,
    confirm,
  );
  let ready = true;
  const acknowledge = jest.fn();
  const deliver = createRootURLDelivery({
    arbiter: createEntryArbiter(),
    controller,
    peek: async () => ({ id: 'cancelled', destination: 'overview' }),
    acknowledge,
    canEnter: () => ready,
    selectTab: jest.fn(),
  });
  const attempt = deliver();
  await Promise.resolve();
  await Promise.resolve();
  ready = false;
  decline?.();
  result.resolve(false);
  expect(await attempt).toBe('deferred');
  ready = true;
  expect(await deliver()).toBe('cancelled');
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(acknowledge).toHaveBeenCalledTimes(1);
});
