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
