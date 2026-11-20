import { createNavigationController } from '../navigationController';

// Approval belongs to one unchanged navigation/leave-state generation, not a route name.
function setup() {
  const controller = createNavigationController<'root' | 'details' | 'other'>(
    'root',
  );
  const root = controller.getSnapshot().currentRoute;
  const child = controller.push('details')!;
  const guard = jest.fn(() => true);
  const unregister = controller.registerLeaveGuard(child.key, guard);
  return { controller, root, child, guard, unregister };
}

describe('approved root commit', () => {
  it('preserves the existing root and consumes approval without a second guard', async () => {
    const { controller, root, child, guard } = setup();
    expect(controller.commitApprovedRoot(child.key)).toBe(false);
    await expect(controller.requestTabSwitchDecision()).resolves.toBe(
      'approved',
    );
    expect(controller.commitApprovedRoot(child.key)).toBe(true);
    expect(controller.getSnapshot().routes).toEqual([root]);
    expect(controller.commitApprovedRoot(root.key)).toBe(false);
    expect(guard).toHaveBeenCalledTimes(1);
    // A discarded child's guard cannot make the retained root leave-safe.
    await expect(controller.requestTabSwitchDecision()).resolves.toBe(
      'unavailable',
    );
  });

  it('supports an already-root route only once', async () => {
    const controller = createNavigationController<'root' | 'details' | 'other'>(
      'root',
    );
    const root = controller.getSnapshot().currentRoute;
    controller.registerLeaveGuard(root.key, () => true);
    await controller.requestTabSwitchDecision();
    expect(controller.commitApprovedRoot(root.key)).toBe(true);
    expect(controller.getSnapshot().currentRoute).toBe(root);
    expect(controller.commitApprovedRoot(root.key)).toBe(false);
  });

  it.each([
    'push',
    'replace',
    'guard',
    'availability',
    'unregister',
    'tab',
    'back',
    'home',
    'native',
  ])('invalidates approval after intervening %s', async change => {
    const { controller, child, unregister } = setup();
    await controller.requestTabSwitchDecision();
    if (change === 'push') controller.push('other');
    if (change === 'replace') controller.replace('other');
    if (change === 'guard')
      controller.registerLeaveGuard(child.key, () => true);
    if (change === 'availability')
      controller.setLeaveStateAvailability(child.key, false);
    if (change === 'unregister') unregister();
    if (change === 'tab') await controller.requestTabSwitch();
    if (change === 'back') await controller.requestBack();
    if (change === 'home') await controller.requestHome();
    if (change === 'native') controller.reconcileNativeBack(child.key);
    expect(
      controller.commitApprovedRoot(controller.getSnapshot().currentRoute.key),
    ).toBe(false);
  });

  it('does not mint approval when the guard changes during confirmation', async () => {
    const { controller, child } = setup();
    let resolve!: (allowed: boolean) => void;
    controller.registerLeaveGuard(
      child.key,
      () =>
        new Promise<boolean>(done => {
          resolve = done;
        }),
    );
    const decision = controller.requestTabSwitchDecision();
    expect(controller.commitApprovedRoot(child.key)).toBe(false);
    controller.registerLeaveGuard(child.key, () => true);
    resolve(true);
    await expect(decision).resolves.toBe('unavailable');
    expect(controller.commitApprovedRoot(child.key)).toBe(false);
  });

  it('invalidates approval when a final publication listener changes leave state', async () => {
    const { controller, child } = setup();
    controller.subscribe(() => {
      if (!controller.getSnapshot().isTransitioning) {
        controller.setLeaveStateAvailability(child.key, false);
      }
    });
    await controller.requestTabSwitchDecision();
    expect(controller.commitApprovedRoot(child.key)).toBe(false);
  });

  it('consumes a mismatched attempt instead of allowing later reuse', async () => {
    const { controller, child } = setup();
    await controller.requestTabSwitchDecision();
    expect(controller.commitApprovedRoot('stale-route')).toBe(false);
    expect(controller.commitApprovedRoot(child.key)).toBe(false);
  });

  it('does not grant a commit through the legacy tab-switch API', async () => {
    const { controller, child } = setup();
    await expect(controller.requestTabSwitch()).resolves.toBe(true);
    expect(controller.commitApprovedRoot(child.key)).toBe(false);
    expect(controller.getSnapshot().currentRoute).toBe(child);
  });

  it.each(['decline', 'throw', 'unavailable'])(
    'fails closed for %s',
    async outcome => {
      const { controller, child, unregister } = setup();
      unregister();
      if (outcome === 'decline')
        controller.registerLeaveGuard(child.key, (_transition, decline) => {
          decline?.();
          return false;
        });
      if (outcome === 'throw')
        controller.registerLeaveGuard(child.key, () => {
          throw new Error('unavailable');
        });
      expect(await controller.requestTabSwitchDecision()).not.toBe('approved');
      expect(controller.commitApprovedRoot(child.key)).toBe(false);
    },
  );
});

it('preserves an explicit decline even when the guard owner changes during confirmation', async () => {
  const { controller, child } = setup();
  controller.registerLeaveGuard(child.key, async (_transition, decline) => {
    decline?.();
    controller.registerLeaveGuard(child.key, () => true);
    return false;
  });
  expect(await controller.requestTabSwitchDecision()).toBe('declined');
  expect(controller.commitApprovedRoot(child.key)).toBe(false);
});
