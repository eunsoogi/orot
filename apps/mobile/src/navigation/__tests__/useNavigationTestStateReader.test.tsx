import { act, renderHook } from '@testing-library/react-native';
import { createNavigationController } from '../navigationController';
import {
  captureNavigationTestSnapshot,
  readNavigationTestState,
  registerNavigationTestObserver,
} from '../navigationTestObservation';
import { useNavigationTestStateReader } from '../useNavigationTestStateReader';

test('detects a controller push and return while native observation is in flight', async () => {
  const stop = registerNavigationTestObserver(jest.fn());
  const controller = createNavigationController<'home' | 'source'>('home');
  const { unmount } = await renderHook(() =>
    useNavigationTestStateReader(controller, true, () => ['route-1']),
  );
  const sample = await captureNavigationTestSnapshot(async () => {
    await act(async () => {
      const source = controller.push('source');
      expect(source).not.toBeNull();
      expect(controller.reconcileNativeBack(source!.key)).toBe(true);
    });
    return {};
  });
  expect(sample.routeState.status).toBe('changed');
  await unmount();
  stop();
});

test('subscribes only with an observer and unregisters on unmount', async () => {
  const controller = createNavigationController<'home'>('home');
  const subscribe = jest.spyOn(controller, 'subscribe');
  const inert = await renderHook(() =>
    useNavigationTestStateReader(controller, true, () => ['route-1']),
  );
  expect(subscribe).not.toHaveBeenCalled();
  await inert.unmount();
  const stop = registerNavigationTestObserver(jest.fn());
  const active = await renderHook(() =>
    useNavigationTestStateReader(controller, true, () => ['route-1']),
  );
  expect(subscribe).toHaveBeenCalledTimes(1);
  expect(readNavigationTestState().status).toBe('single');
  await active.unmount();
  expect(readNavigationTestState().status).toBe('unavailable');
  stop();
});
