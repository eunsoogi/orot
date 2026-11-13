import { act, render, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { createNavigationController } from '../../navigation/navigationController';
import type { AppNavigationRoute } from '../../routes/appNavigationRoute';
import { createEntryArbiter } from '../entryArbiter';
import { RootURLDeliveryHost } from '../RootURLDeliveryHost';
import { rootURLBridge } from '../rootURLBridge';

jest.mock('../rootURLBridge', () => ({
  rootURLBridge: {
    peek: jest.fn(),
    acknowledge: jest.fn(),
    subscribe: jest.fn(() => () => {}),
  },
}));
const bridge = jest.mocked(rootURLBridge);

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'active',
  });
});

test('peeks at mount and applies a cold URL after readiness', async () => {
  let pending: unknown = { id: 'delivery', destination: 'schedule' };
  bridge.peek.mockImplementation(async () => pending);
  bridge.acknowledge.mockImplementation(async () => {
    pending = null;
  });
  const controller = createNavigationController<AppNavigationRoute>('home');
  controller.registerLeaveGuard(
    controller.getSnapshot().currentRoute.key,
    async () => true,
  );
  const arbiter = createEntryArbiter();
  const selectTab = jest.fn();
  const view = await render(
    <RootURLDeliveryHost
      controller={controller}
      arbiter={arbiter}
      ready={false}
      canEnter={() => true}
      selectTab={selectTab}
    />,
  );
  await waitFor(() => expect(bridge.peek).toHaveBeenCalled());
  expect(selectTab).not.toHaveBeenCalled();
  await view.rerender(
    <RootURLDeliveryHost
      controller={controller}
      arbiter={arbiter}
      ready
      canEnter={() => true}
      selectTab={selectTab}
    />,
  );
  await waitFor(() => expect(selectTab).toHaveBeenCalledWith('schedule'));
  expect(selectTab).toHaveBeenCalledTimes(1);
  expect(bridge.acknowledge).toHaveBeenCalledWith('delivery');
});

test('unmount prevents a delayed leave decision from selecting or acknowledging', async () => {
  let release!: (allow: boolean) => void;
  const guard = new Promise<boolean>(resolve => {
    release = resolve;
  });
  bridge.peek.mockResolvedValue({ id: 'delivery', destination: 'records' });
  const controller = createNavigationController<AppNavigationRoute>('home');
  const confirm = jest.fn(() => guard);
  controller.registerLeaveGuard(
    controller.getSnapshot().currentRoute.key,
    confirm,
  );
  const selectTab = jest.fn();
  const view = await render(
    <RootURLDeliveryHost
      controller={controller}
      arbiter={createEntryArbiter()}
      ready
      canEnter={() => true}
      selectTab={selectTab}
    />,
  );
  await waitFor(() => expect(confirm).toHaveBeenCalled());
  await view.unmount();
  await act(async () => {
    release(true);
    await guard;
  });
  expect(selectTab).not.toHaveBeenCalled();
  expect(bridge.acknowledge).not.toHaveBeenCalled();
});

test('a competing transition that settles during an inbox read wakes the pending URL', async () => {
  let releaseGuard!: (allow: boolean) => void;
  let releasePeek!: (value: unknown) => void;
  const guard = new Promise<boolean>(resolve => {
    releaseGuard = resolve;
  });
  const peek = new Promise<unknown>(resolve => {
    releasePeek = resolve;
  });
  let pending: unknown = { id: 'delivery', destination: 'records' };
  bridge.peek.mockResolvedValue(null);
  bridge.acknowledge.mockImplementation(async () => {
    pending = null;
  });
  const controller = createNavigationController<AppNavigationRoute>('home');
  const confirm = jest.fn().mockReturnValueOnce(guard).mockResolvedValue(true);
  controller.registerLeaveGuard(
    controller.getSnapshot().currentRoute.key,
    confirm,
  );
  const selectTab = jest.fn();
  await render(
    <RootURLDeliveryHost
      controller={controller}
      arbiter={createEntryArbiter()}
      ready
      canEnter={() => true}
      selectTab={selectTab}
    />,
  );
  await act(async () => {
    await Promise.resolve();
  });
  bridge.peek.mockClear();
  bridge.peek.mockReturnValueOnce(peek).mockImplementation(async () => pending);
  const transition = controller.requestTabSwitchDecision();
  const wake = bridge.subscribe.mock.calls[0]?.[0];
  if (!wake) throw new Error('The native inbox wake was not registered');
  await act(async () => {
    wake();
    await Promise.resolve();
  });
  expect(bridge.peek).toHaveBeenCalled();
  await act(async () => {
    releasePeek(pending);
    await Promise.resolve();
    releaseGuard(true);
    await transition;
  });
  await waitFor(() => expect(selectTab).toHaveBeenCalledWith('records'));
  expect(selectTab).toHaveBeenCalledTimes(1);
  expect(bridge.acknowledge).toHaveBeenCalledTimes(1);
});
