import { createNavigationController } from '../navigationController';

function setup() {
  const controller = createNavigationController<'root' | 'source' | 'cover'>(
    'root',
  );
  return { controller, root: controller.getSnapshot().currentRoute };
}

test('a native pop observed before the destination mounts retires its exact route', () => {
  const { controller, root } = setup();
  controller.subscribe(() => {
    const { currentRoute } = controller.getSnapshot();
    if (currentRoute.name === 'source')
      controller.reconcileNativeBack(currentRoute.key);
  });
  const pending = controller.pushOwned(root.key, 'source');
  expect(pending?.signal.aborted).toBe(true);
  expect(controller.getSnapshot().currentRoute).toBe(root);
});

test('a covered route does not regain its request on returning to the same key', () => {
  const { controller, root } = setup();
  const pending = controller.pushOwned(root.key, 'source')!;
  const cover = controller.push('cover')!;
  expect(pending.signal.aborted).toBe(true);
  expect(controller.reconcileNativeBack(cover.key)).toBe(true);
  expect(controller.getSnapshot().currentRoute).toBe(pending.route);
  expect(pending.signal.aborted).toBe(true);
});

test('reentrant replacement retires the original destination, never the replacement', () => {
  const { controller, root } = setup();
  controller.subscribe(() => {
    if (controller.getSnapshot().currentRoute.name === 'source')
      controller.replace('cover');
  });
  const pending = controller.pushOwned(root.key, 'source');
  expect(pending?.signal.aborted).toBe(true);
  expect(controller.pushOwned(root.key, 'source')).toBeNull();
  expect(controller.getSnapshot().currentRoute.name).toBe('cover');
});
