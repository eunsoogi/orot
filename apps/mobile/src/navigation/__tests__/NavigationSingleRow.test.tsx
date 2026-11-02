import { act, render, screen } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import type { ReactNode } from 'react';
import { createNavigationController } from '../navigationController';
import { NavigationActionBar } from '../NavigationActionBar';

jest.mock('react-native-safe-area-context', () => {
  const React = require('react') as typeof import('react');
  const { View: NativeView } =
    require('react-native') as typeof import('react-native');

  return {
    SafeAreaInsetsContext: React.createContext(null),
    SafeAreaView: ({
      children,
      edges,
      style,
      testID,
    }: {
      children?: ReactNode;
      edges?: readonly string[];
      style?: object;
      testID?: string;
    }) =>
      React.createElement(
        NativeView,
        { accessibilityHint: edges?.join(','), style, testID },
        children,
      ),
  };
});

describe('measured bottom navigation', () => {
  it('fits Back, Home, Save and Cancel in a 390 point window without hiding actions', async () => {
    const originalWindow = Dimensions.get('window');
    const originalScreen = Dimensions.get('screen');
    const metricsControl = globalThis as typeof globalThis & {
      __OROT_TEST_PAGE_METRICS__?: null;
    };
    metricsControl.__OROT_TEST_PAGE_METRICS__ = null;
    Dimensions.set({
      window: { ...originalWindow, width: 390 },
      screen: { ...originalScreen, width: 390 },
    });
    try {
      const controller = createNavigationController<'home' | 'details'>('home');
      controller.push('details');
      const actions = ['save', 'cancel'].map(id => ({
        id,
        label: id,
        accessibilityLabel: id,
        testID: id,
        systemImageName: id === 'save' ? 'checkmark' : 'xmark',
        onPress: jest.fn(),
      }));
      await render(
        <NavigationActionBar
          controller={controller}
          showHome
          safeAreaHandledByParent
          pageActions={actions}
        />,
      );
      const dock = screen.getByTestId('navigation-bar-native-surface', {
        includeHiddenElements: true,
      });
      await act(async () =>
        dock.props.onPageMetrics({
          nativeEvent: {
            revision: dock.props.pageMetricsRequest.revision,
            width: 374,
            widths: [48, 64, 88, 88, 44],
            heights: [48, 48, 48, 48, 48],
          },
        }),
      );
      expect(screen.getByTestId('navigation-bottom-single-row')).toBeTruthy();
      const resizedDock = screen.getByTestId('navigation-bar-native-surface', {
        includeHiddenElements: true,
      });
      await act(async () =>
        resizedDock.props.onPageMetrics({
          nativeEvent: {
            revision: resizedDock.props.pageMetricsRequest.revision,
            width: 374,
            widths: [48, 64, 88, 88, 44],
            heights: [48, 48, 48, 48, 48],
          },
        }),
      );
      expect(screen.getByTestId('save')).toBeTruthy();
      expect(screen.getByTestId('cancel')).toBeTruthy();
      expect(
        screen.queryByTestId('navigation-page-action-overflow'),
      ).toBeNull();
      await act(async () => {
        Dimensions.set({
          window: { ...originalWindow, width: 320 },
          screen: { ...originalScreen, width: 320 },
        });
      });
      expect(screen.queryByTestId('navigation-bottom-single-row')).toBeNull();
      expect(screen.getByRole('progressbar')).toBeTruthy();
    } finally {
      await act(async () => {
        Dimensions.set({ window: originalWindow, screen: originalScreen });
      });
      delete metricsControl.__OROT_TEST_PAGE_METRICS__;
    }
  });
  it('keeps the root tabs and a page action together when the measured row fits', async () => {
    const metricsControl = globalThis as typeof globalThis & {
      __OROT_TEST_PAGE_METRICS__?: null;
    };
    metricsControl.__OROT_TEST_PAGE_METRICS__ = null;
    try {
      const onSelect = jest.fn();
      const retry = jest.fn();
      const controller = createNavigationController<'home'>('home');
      const view = await render(
        <NavigationActionBar
          controller={controller}
          safeAreaHandledByParent
          rootTabs={{ activeTab: 'home', onSelect }}
          pageActions={[
            {
              id: 'retry',
              label: 'Retry',
              accessibilityLabel: 'Retry',
              testID: 'retry',
              systemImageName: 'arrow.clockwise',
              onPress: retry,
            },
          ]}
        />,
      );
      const dock = screen.getByTestId('navigation-bar-native-surface', {
        includeHiddenElements: true,
      });
      await act(async () =>
        dock.props.onPageMetrics({
          nativeEvent: {
            revision: dock.props.pageMetricsRequest.revision,
            width: 750,
            widths: [44, 44, 44, 44, 44, 88, 44],
            heights: [60, 60, 60, 60, 60, 48, 48],
          },
        }),
      );
      expect(screen.getByTestId('navigation-bottom-single-row')).toBeTruthy();
      expect(screen.getByTestId('navigation-tab-home')).toBeTruthy();
      expect(
        screen.getByTestId('navigation-page-action-overflow'),
      ).toBeTruthy();
      await act(async () =>
        screen
          .getByTestId('navigation-page-action-surface')
          .props.onAction({ nativeEvent: { id: 'page:retry' } }),
      );
      expect(retry).toHaveBeenCalledTimes(1);
      await view.rerender(
        <NavigationActionBar
          controller={controller}
          safeAreaHandledByParent
          rootTabs={{ activeTab: 'home', onSelect }}
          pageActions={[
            {
              id: 'retry',
              label: 'Retry after reconnecting',
              accessibilityLabel: 'Retry after reconnecting',
              testID: 'retry',
              systemImageName: 'arrow.clockwise',
              onPress: retry,
            },
          ]}
        />,
      );
      // A changed title must be remeasured before the compact row can return.
      expect(screen.queryByTestId('navigation-bottom-single-row')).toBeNull();
    } finally {
      delete metricsControl.__OROT_TEST_PAGE_METRICS__;
    }
  });
  it('places navigation and page actions in one measured row when both fit', async () => {
    const metricsControl = globalThis as typeof globalThis & {
      __OROT_TEST_PAGE_METRICS__?: null;
    };
    metricsControl.__OROT_TEST_PAGE_METRICS__ = null;
    try {
      const controller = createNavigationController<'home' | 'details'>('home');
      controller.push('details');
      await render(
        <NavigationActionBar
          controller={controller}
          showHome
          safeAreaHandledByParent
          pageActions={[
            {
              id: 'save',
              label: 'Save',
              accessibilityLabel: 'Save',
              testID: 'save',
              systemImageName: 'checkmark',
              onPress: jest.fn(),
            },
          ]}
        />,
      );
      const dock = screen.getByTestId('navigation-bar-native-surface', {
        includeHiddenElements: true,
      });
      const revision = dock.props.pageMetricsRequest.revision;
      await act(async () =>
        dock.props.onPageMetrics({
          nativeEvent: {
            revision,
            width: 390,
            widths: [48, 64, 80, 44],
            heights: [48, 48, 48, 48],
          },
        }),
      );
      expect(screen.getByTestId('navigation-bottom-single-row')).toBeTruthy();
      const row = screen.getByTestId('navigation-bottom-single-row');
      expect(row.props.pointerEvents).toBe('box-none');
      const pageParent = screen.getByTestId(
        'navigation-page-action-surface',
      ).parent;
      expect(StyleSheet.flatten(pageParent?.props.style)).toEqual(
        expect.objectContaining({ position: 'absolute', zIndex: 1 }),
      );
      expect(screen.getByTestId('navigation-back')).toBeTruthy();
      expect(screen.getByTestId('navigation-home')).toBeTruthy();
      expect(screen.getByTestId('save')).toBeTruthy();
    } finally {
      delete metricsControl.__OROT_TEST_PAGE_METRICS__;
    }
  });
});
