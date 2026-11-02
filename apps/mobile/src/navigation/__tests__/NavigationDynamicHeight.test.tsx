import { act, render, screen } from '@testing-library/react-native';
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
  it('reserves measured height even on a root screen without page actions', async () => {
    const metricsControl = globalThis as typeof globalThis & {
      __OROT_TEST_PAGE_METRICS__?: null;
    };
    metricsControl.__OROT_TEST_PAGE_METRICS__ = null;
    try {
      const controller = createNavigationController<'home'>('home');
      await render(
        <NavigationActionBar
          controller={controller}
          safeAreaHandledByParent
          rootTabs={{ activeTab: 'home', onSelect: jest.fn() }}
        />,
      );
      const surface = screen.getByTestId('navigation-bar-native-surface', {
        includeHiddenElements: true,
      });
      await act(async () =>
        surface.props.onPageMetrics({
          nativeEvent: {
            revision: surface.props.pageMetricsRequest.revision,
            width: 390,
            widths: [60, 60, 60, 60, 60, 44],
            heights: [110, 110, 110, 110, 110, 60],
          },
        }),
      );
      expect(
        screen.getByTestId('navigation-bar-native-surface').props.bottomHeight,
      ).toBe(110);
    } finally {
      delete metricsControl.__OROT_TEST_PAGE_METRICS__;
    }
  });
  it('shares measured text height with both bottom surfaces', async () => {
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
      await act(async () =>
        dock.props.onPageMetrics({
          nativeEvent: {
            revision: dock.props.pageMetricsRequest.revision,
            width: 390,
            widths: [48, 64, 80, 44],
            heights: [70, 70, 90, 70],
          },
        }),
      );
      expect(
        screen.getByTestId('navigation-bar-native-surface').props.bottomHeight,
      ).toBe(90);
      expect(
        screen.getByTestId('navigation-page-action-surface').props.bottomHeight,
      ).toBe(90);
    } finally {
      delete metricsControl.__OROT_TEST_PAGE_METRICS__;
    }
  });
});
