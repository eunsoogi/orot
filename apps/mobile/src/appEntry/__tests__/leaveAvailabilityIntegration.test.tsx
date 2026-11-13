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

test('a committed leave-state readiness change resumes a deferred root entry once', async () => {
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'active',
  });
  let pending: unknown = { id: 'entry', destination: 'records' };
  jest.mocked(rootURLBridge.peek).mockImplementation(async () => pending);
  jest.mocked(rootURLBridge.acknowledge).mockImplementation(async () => {
    pending = null;
  });
  const controller = createNavigationController<AppNavigationRoute>('home');
  const decision = jest.spyOn(controller, 'requestTabSwitchDecision');
  const selectTab = jest.fn();
  await render(
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
  expect(selectTab).toHaveBeenCalledWith('records');
  expect(rootURLBridge.acknowledge).toHaveBeenCalledWith('entry');
});
