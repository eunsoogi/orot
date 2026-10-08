import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useLayoutEffect } from 'react';
import { Text } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import type { ReactNode } from 'react';
import { createNavigationController } from '../navigationController';
import { NavigationRouteAdapter } from '../NavigationRouteAdapter';
import type {
  NavigationLeaveStateSource,
  NavigationRouteActions,
} from '../index';

jest.mock('react-native-safe-area-context', () => {
  const React = require('react') as typeof import('react');
  const { View: NativeView } =
    require('react-native') as typeof import('react-native');

  return {
    SafeAreaProvider: ({ children }: { children?: ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    SafeAreaView: ({
      children,
      edges,
      style,
      testID,
    }: {
      children?: ReactNode;
      edges?: readonly string[];
      style?: StyleProp<ViewStyle>;
      testID?: string;
    }) =>
      React.createElement(
        NativeView,
        { accessibilityHint: edges?.join(','), style, testID },
        children,
      ),
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

describe('app navigation route adapter', () => {
  it('uses the active screen state source registered by that screen', async () => {
    const controller = createNavigationController<TestRoute>('home');
    controller.push('editor');
    const confirm = jest.fn(async () => false);
    const source: NavigationLeaveStateSource<TestRoute> = {
      readState: () => ({
        hasUnsavedChanges: true,
        isRecording: false,
        hasOngoingOperation: false,
        revision: 3,
        inputRevision: 3,
      }),
      confirm,
    };

    await render(
      <NavigationRouteAdapter controller={controller}>
        {({ route, registerLeaveState }) => (
          <>
            <RegisterLeaveState register={registerLeaveState} source={source} />
            <Text>{route.name}</Text>
          </>
        )}
      </NavigationRouteAdapter>,
    );

    await fireEvent.press(
      screen.getByRole('button', { name: '이전 화면으로 돌아가기' }),
    );
    expect(controller.getSnapshot().currentRoute.name).toBe('editor');
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('fails closed if the active screen has not registered leave state', async () => {
    const controller = createNavigationController<TestRoute>('home');
    controller.push('editor');

    await render(
      <NavigationRouteAdapter controller={controller}>
        {({ route }) => <Text>{route.name}</Text>}
      </NavigationRouteAdapter>,
    );

    await fireEvent.press(
      screen.getByRole('button', { name: '이전 화면으로 돌아가기' }),
    );
    expect(controller.getSnapshot().currentRoute.name).toBe('editor');
  });

  it('lets each route delegate content insets to its own safe-area owner', async () => {
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
    const childOwnsInsets = jest.fn(route => route.name === 'editor');

    await render(
      <NavigationRouteAdapter
        controller={controller}
        contentSafeAreaHandledByChild={childOwnsInsets}
      >
        {({ route, registerLeaveState }) => (
          <>
            <RegisterLeaveState register={registerLeaveState} source={source} />
            <Text>{route.name}</Text>
          </>
        )}
      </NavigationRouteAdapter>,
    );

    expect(screen.getAllByA11yHint('top,right,left')).toHaveLength(1);

    await act(async () => {
      controller.push('editor');
    });

    expect(screen.queryAllByA11yHint('top,right,left')).toHaveLength(0);
    expect(childOwnsInsets).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'editor' }),
    );
  });

  it('keeps the action bar in a keyboard-avoiding root instead of removing it', async () => {
    const controller = createNavigationController<TestRoute>('home');
    controller.push('editor');

    await render(
      <NavigationRouteAdapter controller={controller}>
        {({ route }) => <Text>{route.name}</Text>}
      </NavigationRouteAdapter>,
    );

    expect(
      screen.getByTestId('navigation-keyboard-avoiding-root'),
    ).toBeVisible();
    expect(screen.getByTestId('navigation-back')).toBeVisible();
  });
});
