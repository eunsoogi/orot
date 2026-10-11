import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useLayoutEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { createNavigationController } from '../navigationController';
import { NavigationRouteAdapter } from '../NavigationRouteAdapter';
import type {
  NavigationLeaveStateSource,
  NavigationRouteActions,
} from '../index';

jest.mock('react-native-safe-area-context', () => {
  const React = require('react') as typeof import('react');
  return {
    SafeAreaInsetsContext: React.createContext({
      top: 0,
      left: 0,
      right: 0,
      bottom: 34,
    }),
    useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0, bottom: 34 }),
    SafeAreaProvider: ({ children }: { children?: ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    SafeAreaView: ({ children }: { children?: ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

type TestRoute = 'home' | 'editor';

function RegisterLeaveState({
  register,
  source,
}: {
  register: NavigationRouteActions<TestRoute>['registerLeaveState'];
  source: NavigationLeaveStateSource<TestRoute>;
}) {
  useLayoutEffect(() => register(source), [register, source]);
  return null;
}

function StatefulHomeRoute() {
  const [draft, setDraft] = useState('');
  return (
    <Text testID="home-draft" onPress={() => setDraft('preserved')}>
      {draft || 'empty'}
    </Text>
  );
}

// Retained native stack scenes keep drafts intact across a forward/back transition.
test('preserves the previous route scene state while opening and leaving a child route', async () => {
  const controller = createNavigationController<TestRoute>('home');
  const source: NavigationLeaveStateSource<TestRoute> = {
    readState: () => ({
      hasUnsavedChanges: false,
      isRecording: false,
      hasOngoingOperation: false,
      revision: 0,
      inputRevision: 0,
    }),
  };

  await render(
    <NavigationRouteAdapter controller={controller}>
      {({ route, registerLeaveState }) => (
        <>
          <RegisterLeaveState register={registerLeaveState} source={source} />
          {route.name === 'home' ? <StatefulHomeRoute /> : <Text>editor</Text>}
        </>
      )}
    </NavigationRouteAdapter>,
  );
  fireEvent.press(screen.getByTestId('home-draft'));
  await act(async () => {
    controller.push('editor');
  });
  await fireEvent.press(
    screen.getByRole('button', { name: '이전 화면으로 돌아가기' }),
  );

  expect(controller.getSnapshot().currentRoute.name).toBe('home');
  expect(
    screen.getByTestId('home-draft', { includeHiddenElements: true }),
  ).toHaveTextContent('preserved');
});
