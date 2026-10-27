import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useEffect, useLayoutEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import { AdaptiveColumns } from '../../layout/AdaptiveColumns';
import { appContentLayoutOwner } from '../appContentLayoutPolicy';
import { createNavigationController } from '../navigationController';
import { NavigationRouteAdapter } from '../NavigationRouteAdapter';
import type {
  NavigationLeaveStateSource,
  NavigationRouteActions,
} from '../index';

const measurableView = View as unknown as {
  prototype: {
    measureInWindow: (
      callback: (x: number, y: number, width: number, height: number) => void,
    ) => void;
  };
};
const windowBounds = new Map<
  string,
  { readonly x: number; readonly width: number }
>();

beforeEach(() => windowBounds.clear());

jest
  .spyOn(measurableView.prototype, 'measureInWindow')
  .mockImplementation(function (
    this: { readonly props: { readonly testID?: string } },
    callback,
  ) {
    const bounds = windowBounds.get(this.props.testID ?? '');
    if (bounds) callback(bounds.x, 0, bounds.width, 600);
  });

function setWindowBounds(testID: string, x: number, width: number) {
  windowBounds.set(testID, { x, width });
}

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

type TestRoute = 'home' | 'editor' | 'visit-questions';

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

function StatefulHomeRoute({
  onStartRequest,
}: {
  readonly onStartRequest: () => void;
}) {
  const [draft, setDraft] = useState('');
  useEffect(() => {
    onStartRequest();
  }, [onStartRequest]);
  return (
    <AdaptiveColumns
      primary={
        <Text testID="home-draft" onPress={() => setDraft('preserved')}>
          {draft || 'empty'}
        </Text>
      }
      secondary={<Text testID="home-selection">selected record</Text>}
      testID="home-columns"
    />
  );
}

// Retained native stack scenes keep drafts intact across a forward/back transition.
test('preserves the previous route scene state while opening and leaving a child route', async () => {
  const controller = createNavigationController<TestRoute>('home');
  const onStartRequest = jest.fn();
  const rootRouteKey = controller.getSnapshot().currentRoute.key;
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
          {route.name === 'home' ? (
            <StatefulHomeRoute onStartRequest={onStartRequest} />
          ) : (
            <Text>editor</Text>
          )}
        </>
      )}
    </NavigationRouteAdapter>,
  );
  const windowWidth = Dimensions.get('window').width;
  expect(
    StyleSheet.flatten(screen.getByTestId('home-columns').props.style)?.width,
  ).toBe(windowWidth);
  await fireEvent.press(screen.getByTestId('home-draft'));
  setWindowBounds('home-columns-host', 0, windowWidth);
  await fireEvent(screen.getByTestId('home-columns-host'), 'layout', {
    nativeEvent: {
      layout: { width: windowWidth, height: 600, x: 0, y: 0 },
    },
  });
  expect(
    StyleSheet.flatten(screen.getByTestId('home-columns').props.style)?.width,
  ).toBe(windowWidth);
  expect(controller.getSnapshot().currentRoute.key).toBe(rootRouteKey);
  expect(onStartRequest).toHaveBeenCalledTimes(1);
  await act(async () => {
    controller.push('editor');
  });
  await fireEvent.press(
    screen.getByRole('button', { name: '이전 화면으로 돌아가기' }),
  );

  expect(controller.getSnapshot().currentRoute.name).toBe('home');
  expect(controller.getSnapshot().currentRoute.key).toBe(rootRouteKey);
  expect(onStartRequest).toHaveBeenCalledTimes(1);
  expect(
    screen.getByTestId('home-draft', { includeHiddenElements: true }),
  ).toHaveTextContent('preserved');
});

test('Schedule and Visit Questions bypass scene-owned columns', async () => {
  const controller = createNavigationController<TestRoute>('home');
  const rootTabs = { activeTab: 'schedule' as const, onSelect: jest.fn() };
  const homeKey = controller.getSnapshot().currentRoute.key;

  await render(
    <NavigationRouteAdapter
      contentLayoutOwner={appContentLayoutOwner}
      controller={controller}
      rootTabs={route => (route.name === 'home' ? rootTabs : undefined)}
    >
      {({ route }) => <Text testID={`route-${route.name}`}>{route.name}</Text>}
    </NavigationRouteAdapter>,
  );

  expect(
    screen.queryByTestId(`navigation-route-columns-${homeKey}`),
  ).toBeNull();

  await act(async () => {
    controller.push('editor');
  });
  const editorKey = controller.getSnapshot().currentRoute.key;
  expect(
    screen.getByTestId(`navigation-route-columns-${editorKey}`),
  ).toBeTruthy();

  await act(async () => {
    controller.push('visit-questions');
  });
  const questionsKey = controller.getSnapshot().currentRoute.key;
  expect(
    screen.queryByTestId(`navigation-route-columns-${questionsKey}`),
  ).toBeNull();
});

test('lets the Records root tab own the full lane for its adaptive panels', async () => {
  const controller = createNavigationController<TestRoute>('home');
  const rootTabs = { activeTab: 'records' as const, onSelect: jest.fn() };
  const homeKey = controller.getSnapshot().currentRoute.key;

  await render(
    <NavigationRouteAdapter
      contentLayoutOwner={appContentLayoutOwner}
      controller={controller}
      rootTabs={route => (route.name === 'home' ? rootTabs : undefined)}
    >
      {({ route }) => <Text testID={`route-${route.name}`}>{route.name}</Text>}
    </NavigationRouteAdapter>,
  );

  // The Records root tab is presented by `home`, so its selected tab owns layout.
  expect(screen.getByTestId('route-home')).toBeTruthy();
  expect(
    screen.queryByTestId(`navigation-route-columns-${homeKey}`),
  ).toBeNull();
});
