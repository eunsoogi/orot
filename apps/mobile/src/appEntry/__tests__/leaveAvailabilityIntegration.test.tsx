import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { useState } from 'react';
import { AppState, Text } from 'react-native';
import { NavigationRouteAdapter } from '../../navigation/NavigationRouteAdapter';
import { createNavigationController } from '../../navigation/navigationController';
import { useNavigationLeaveStateRegistration } from '../../navigation/useNavigationLeaveStateRegistration';
import type { AppNavigationRoute } from '../../routes/appNavigationRoute';
import { createEntryArbiter } from '../entryArbiter';
import { RootURLDeliveryHost } from '../RootURLDeliveryHost';
import { rootURLBridge } from '../rootURLBridge';

jest.mock('react-native-safe-area-context', () => {
  const React = require('react') as typeof import('react');
  return {
    SafeAreaInsetsContext: React.createContext({
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    }),
    useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0, bottom: 0 }),
    SafeAreaProvider: ({ children }: { children?: React.ReactNode }) => (
      <>{children}</>
    ),
    SafeAreaView: ({ children }: { children?: React.ReactNode }) => (
      <>{children}</>
    ),
  };
});

jest.mock('../rootURLBridge', () => ({
  rootURLBridge: {
    peek: jest.fn(),
    acknowledge: jest.fn(),
    subscribe: jest.fn(() => () => {}),
  },
}));

beforeEach(() => jest.clearAllMocks());

function Route() {
  const [ready, setReady] = useState(false);
  useNavigationLeaveStateRegistration({
    canLeave: ready,
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: false,
    revision: ready ? 1 : 0,
    inputRevision: 0,
  });
  return <Text onPress={() => setReady(true)}>Make ready</Text>;
}

test.each(['records', 'conversation'] as const)(
  'a committed leave-state readiness change resumes a deferred %s root entry once',
  async destination => {
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'active',
    });
    let pending: unknown = { id: 'entry', destination };
    jest.mocked(rootURLBridge.peek).mockImplementation(async () => pending);
    jest.mocked(rootURLBridge.acknowledge).mockImplementation(async () => {
      pending = null;
    });
    const controller = createNavigationController<AppNavigationRoute>('root');
    const decision = jest.spyOn(controller, 'requestTabSwitchDecision');
    const selectTab = jest.fn();
    const view = await render(
      <>
        <NavigationRouteAdapter controller={controller}>
          {() => <Route />}
        </NavigationRouteAdapter>
        <RootURLDeliveryHost
          controller={controller}
          arbiter={createEntryArbiter()}
          ready
          canEnter={() => true}
          selectTab={selectTab}
        />
      </>,
    );
    await waitFor(() => expect(decision).toHaveBeenCalled());
    await expect(decision.mock.results[0]?.value).resolves.toBe('unavailable');
    expect(selectTab).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.press(screen.getByText('Make ready'));
    });
    await waitFor(() => expect(selectTab).toHaveBeenCalledTimes(1));
    expect(selectTab).toHaveBeenCalledWith(destination);
    expect(rootURLBridge.acknowledge).toHaveBeenCalledTimes(1);
    expect(pending).toBeNull();
    expect(rootURLBridge.acknowledge).toHaveBeenCalledWith('entry');
    const wake = jest.fn();
    controller.subscribeEntryAvailability(wake);
    await view.unmount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(wake).not.toHaveBeenCalled();
  },
);

function CleanRoute() {
  const [revision, setRevision] = useState(0);
  useNavigationLeaveStateRegistration({
    canLeave: true,
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: false,
    revision,
    inputRevision: revision,
  });
  return (
    <Text onPress={() => setRevision(value => value + 1)}>Revise owner</Text>
  );
}

// Stable guard identity is not permission to retain approval across real owner changes.
test.each(['revision', 'replacement', 'unmount'] as const)(
  'a real %s still revokes an approved canonical root entry',
  async change => {
    const controller = createNavigationController<AppNavigationRoute>('root');
    const routeKey = controller.getSnapshot().currentRoute.key;
    const tree = (owner: string) => (
      <NavigationRouteAdapter controller={controller}>
        {() => <CleanRoute key={owner} />}
      </NavigationRouteAdapter>
    );
    const view = await render(tree('first'));
    let decision: string | undefined;
    await act(async () => {
      decision = await controller.requestTabSwitchDecision();
    });
    expect(decision).toBe('approved');
    if (change === 'revision')
      await fireEvent.press(screen.getByText('Revise owner'));
    else if (change === 'replacement') await view.rerender(tree('second'));
    else await view.unmount();
    expect(controller.commitApprovedRoot(routeKey)).toBe(false);
    if (change !== 'unmount') {
      await act(async () => {
        decision = await controller.requestTabSwitchDecision();
      });
      expect(decision).toBe('approved');
      await act(async () => {
        expect(controller.commitApprovedRoot(routeKey)).toBe(true);
        expect(controller.commitApprovedRoot(routeKey)).toBe(false);
      });
      await view.unmount();
    }
  },
);
