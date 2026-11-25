import { act, fireEvent, render, screen } from '@testing-library/react-native';
import {
  AccessibilityInfo,
  AppState,
  NativeModules,
  Platform,
  RefreshControl,
  Text,
} from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { useEffect, type ReactNode } from 'react';
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
      const control = screen.getByTestId('navigation-route-scroll').props
        .refreshControl;
      if (routeName !== 'medical-document-detail') {
        expect(control).toBeUndefined();
        expect(reads).not.toHaveBeenCalled();
        return;
      }
      expect(control.type).toBe(RefreshControl);
      expect(reads).not.toHaveBeenCalled();
      await act(async () => {
        await control.props.onRefresh();
      });
      expect(reads.mock.calls).toEqual([['fixture-selected']]);
      expect(screen.getByText('Synthetic selected detail')).toBeVisible();
    },
  );
  it('plays one haptic for an accepted pull only', async () => {
    const old = NativeModules.RouteRefreshFeedbackModule;
    const os = Platform.OS;
    const appState = AppState.currentState;
    const impact = jest.fn();
    const controller = createNavigationController<
      'home' | 'medical-document-detail'
    >('home');
    let allow = false;
    let complete!: () => void;
    const held = new Promise<void>(resolve => {
      complete = resolve;
    });
    const read = jest.fn(async () => undefined);
    const retry = () => {
      read().catch(() => undefined);
    };
    function Detail() {
      useEffect(() => {
        read().catch(() => undefined);
      }, []);
      useNavigationRouteRefresh(true, async accept => {
        if (!allow) return;
        accept();
        accept();
        await read();
        await held;
      });
      return <Text onPress={retry}>Synthetic Retry</Text>;
    }
    try {
      Platform.OS = 'ios';
      AppState.currentState = 'active';
      NativeModules.RouteRefreshFeedbackModule = { didAcceptPull: impact };
      controller.push('medical-document-detail');
      await render(
        <NavigationRouteAdapter
          controller={controller}
          scrollable={route => appRouteIsScrollable(route, 'conversation')}
        >
          {() => <Detail />}
        </NavigationRouteAdapter>,
      );
      expect(impact).not.toHaveBeenCalled();
      expect(read).toHaveBeenCalledTimes(1);
      await fireEvent.press(screen.getByText('Synthetic Retry'));
      expect(read).toHaveBeenCalledTimes(2);
      expect(impact).not.toHaveBeenCalled();
      const scroll = screen.getByTestId('navigation-route-scroll');
      const { onRefresh: pull } = scroll.props.refreshControl.props;
      await act(async () => {
        await pull();
      });
      expect(impact).not.toHaveBeenCalled();
      allow = true;
      let first: Promise<void> | undefined;
      await act(async () => {
        first = pull();
        await pull();
      });
      expect(impact).toHaveBeenCalledTimes(1);
      expect(read).toHaveBeenCalledTimes(3);
      await act(async () => {
        complete();
        await first;
      });
    } finally {
      complete();
      NativeModules.RouteRefreshFeedbackModule = old;
      Platform.OS = os;
      AppState.currentState = appState;
    }
  });
});
