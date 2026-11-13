import { createNavigationController } from '../navigationController';

test('signals only meaningful active readiness, coalescing guard replacement and stale cleanup', async () => {
  const controller = createNavigationController('home');
  const key = controller.getSnapshot().currentRoute.key;
  const listener = jest.fn();
  controller.subscribeEntryAvailability(listener);
  controller.setLeaveStateAvailability(key, false);
  const removeOld = controller.registerLeaveGuard(key, async () => true);
  await Promise.resolve();
  expect(listener).not.toHaveBeenCalled();

  controller.setLeaveStateAvailability(key, true);
  await Promise.resolve();
  expect(listener).toHaveBeenCalledTimes(1);
  const removeCurrent = controller.registerLeaveGuard(key, async () => true);
  removeOld();
  controller.setLeaveStateAvailability(key, true);
  await Promise.resolve();
  expect(listener).toHaveBeenCalledTimes(1);

  removeCurrent();
  await Promise.resolve();
  controller.registerLeaveGuard(key, async () => true);
  await Promise.resolve();
  expect(listener).toHaveBeenCalledTimes(2);
});

test('inactive owners and removed guards do not wake a pending entry', async () => {
  const controller = createNavigationController<'home' | 'detail'>('home');
  const home = controller.getSnapshot().currentRoute.key;
  const listener = jest.fn();
  controller.subscribeEntryAvailability(listener);
  const removeHome = controller.registerLeaveGuard(home, async () => true);
  controller.setLeaveStateAvailability(home, true);
  await Promise.resolve();
  const detail = controller.push('detail')!;
  await Promise.resolve();
  listener.mockClear();
  controller.setLeaveStateAvailability(home, false);
  controller.setLeaveStateAvailability(home, true);
  removeHome();
  await Promise.resolve();
  expect(listener).not.toHaveBeenCalled();
  const removeDetail = controller.registerLeaveGuard(
    detail.key,
    async () => true,
  );
  controller.setLeaveStateAvailability(detail.key, true);
  await Promise.resolve();
  expect(listener).toHaveBeenCalledTimes(1);
  removeDetail();
  controller.setLeaveStateAvailability(detail.key, false);
  await Promise.resolve();
  expect(listener).toHaveBeenCalledTimes(1);
});
