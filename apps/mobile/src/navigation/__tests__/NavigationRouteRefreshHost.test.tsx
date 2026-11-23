import { act, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, RefreshControl, Text } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import type { ReactNode } from 'react';
import { appRouteIsScrollable } from '../appContentLayoutPolicy';
import { useNavigationRouteRefresh } from '../navigationRouteRefresh';
import { createNavigationController } from '../navigationController';
import { NavigationRouteAdapter } from '../NavigationRouteAdapter';

jest.mock('react-native-safe-area-context', () => {
  const React = require('react') as typeof import('react');
  const { View: NativeView } =
    require('react-native') as typeof import('react-native');

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

describe('shared route refresh control', () => {
  beforeEach(() => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each(['medical-document-detail', 'manual-history'] as const)(
    'only gives the authorized detail a shared scroll refresh control (%s)',
    async routeName => {
      const controller = createNavigationController<
        'home' | 'medical-document-detail' | 'manual-history'
      >('home');
      controller.push(routeName);
      const reads = jest.fn(async (_id: string) => undefined);
      function SelectedDetail() {
        useNavigationRouteRefresh(true, () => reads('fixture-selected'));
        return <Text>Synthetic selected detail</Text>;
      }
      await render(
        <NavigationRouteAdapter
          controller={controller}
          scrollable={route => appRouteIsScrollable(route, 'conversation')}
        >
          {({ route }) =>
            route.name === 'home' ? <Text>Home</Text> : <SelectedDetail />
          }
        </NavigationRouteAdapter>,
      );
      const controls = screen.UNSAFE_queryAllByType(RefreshControl);
      if (routeName !== 'medical-document-detail') {
        expect(controls).toHaveLength(0);
        expect(reads).not.toHaveBeenCalled();
        return;
      }
      expect(controls).toHaveLength(1);
      expect(reads).not.toHaveBeenCalled();
      await act(async () => {
        await controls[0]!.props.onRefresh();
      });
      expect(reads.mock.calls).toEqual([['fixture-selected']]);
      expect(screen.getByText('Synthetic selected detail')).toBeVisible();
    },
  );
});
