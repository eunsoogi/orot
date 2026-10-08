import type {
  NavigationController,
  NavigationRoute,
} from '../navigationController';
import { createNavigationController } from '../navigationController';

type TestRoute = 'home' | 'details' | 'editor' | 'recording' | 'other';

function makeController() {
  return createNavigationController<TestRoute>('home');
}

function pushRoute(
  controller: NavigationController<TestRoute>,
  name: TestRoute,
): NavigationRoute<TestRoute> {
  const route = controller.push(name);
  if (!route) throw new Error('Route push was unexpectedly rejected.');
  return route;
}

function deferred<Value>() {
  let resolve: (value: Value) => void = () => {};
  const promise = new Promise<Value>(complete => {
    resolve = complete;
  });

  return { promise, resolve };
}

describe('navigation controller', () => {
  it('keeps the active route when the shared back guard declines', async () => {
    const controller = makeController();
    const child = pushRoute(controller, 'recording');
    const guard = jest.fn(async () => false);
    controller.registerLeaveGuard(child.key, guard);

    await expect(controller.requestBack()).resolves.toBe(false);
    expect(controller.getSnapshot().currentRoute.name).toBe('recording');
    expect(guard).toHaveBeenCalledWith({
      intent: 'back',
      from: child,
      to: controller.getSnapshot().routes[0],
    });
  });

  it('allows only one pending leave confirmation and pops once', async () => {
    const controller = makeController();
    const child = pushRoute(controller, 'details');
    const decision = deferred<boolean>();
    const guard = jest.fn(() => decision.promise);
    controller.registerLeaveGuard(child.key, guard);

    const first = controller.requestBack();
    await expect(controller.requestBack()).resolves.toBe(false);
    expect(guard).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().isTransitioning).toBe(true);

    decision.resolve(true);
    await expect(first).resolves.toBe(true);
    expect(controller.getSnapshot().routes).toHaveLength(1);
    expect(controller.getSnapshot().currentRoute.name).toBe('home');
    expect(controller.getSnapshot().isTransitioning).toBe(false);
  });

  it('uses the same leave guard when returning home', async () => {
    const controller = makeController();
    pushRoute(controller, 'details');
    const current = pushRoute(controller, 'editor');
    const guard = jest.fn(async () => true);
    controller.registerLeaveGuard(current.key, guard);

    await expect(controller.requestHome()).resolves.toBe(true);
    expect(guard).toHaveBeenCalledWith({
      intent: 'home',
      from: current,
      to: controller.getSnapshot().routes[0],
    });
    expect(controller.getSnapshot().routes).toHaveLength(1);
  });

  it('does not allow route changes while a leave decision is pending', async () => {
    const controller = makeController();
    const child = pushRoute(controller, 'details');
    const decision = deferred<boolean>();
    controller.registerLeaveGuard(child.key, () => decision.promise);

    const pendingBack = controller.requestBack();
    expect(controller.push('recording')).toBeNull();
    expect(controller.replace('other')).toBeNull();

    decision.resolve(false);
    await expect(pendingBack).resolves.toBe(false);
    expect(controller.getSnapshot().currentRoute.name).toBe('details');
  });

  it('fails closed when a leave guard rejects', async () => {
    const controller = makeController();
    const child = pushRoute(controller, 'details');
    controller.registerLeaveGuard(child.key, async () => {
      throw new Error('confirmation unavailable');
    });

    await expect(controller.requestBack()).resolves.toBe(false);
    expect(controller.getSnapshot().currentRoute.name).toBe('details');
    expect(controller.getSnapshot().isTransitioning).toBe(false);
  });

  it('fails closed when an active route has no leave-state registration', async () => {
    const controller = makeController();
    pushRoute(controller, 'details');

    await expect(controller.requestBack()).resolves.toBe(false);
    expect(controller.getSnapshot().currentRoute.name).toBe('details');
  });
});
