import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import type { ReactNode } from 'react';
import { BottomNavigationMenu } from '../BottomNavigationMenu';

jest.mock('react-native-safe-area-context', () => {
  const React = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');
  return {
    SafeAreaInsetsContext: React.createContext(null),
    SafeAreaView: ({
      children,
      style,
    }: {
      children?: ReactNode;
      style?: object;
    }) => React.createElement(View, { style }, children),
  };
});

describe('callback route bottom navigation', () => {
  it('routes callback-route actions through the native toolbar items', async () => {
    const metricsControl = globalThis as typeof globalThis & {
      __OROT_TEST_PAGE_METRICS__?: null;
    };
    metricsControl.__OROT_TEST_PAGE_METRICS__ = null;
    const onBack = jest.fn();
    const onHome = jest.fn();
    const onPrimary = jest.fn();
    await render(
      <BottomNavigationMenu
        onBack={onBack}
        onHome={onHome}
        testID="calendar-back"
        primaryAction={{
          label: '녹음',
          accessibilityLabel: '녹음 화면으로 이동',
          onPress: onPrimary,
          testID: 'navigation-recording',
          systemImageName: 'mic',
        }}
      />,
    );

    await act(async () => {
      fireEvent(screen.getByTestId('bottom-navigation-menu-host'), 'layout', {
        nativeEvent: { layout: { width: 430, height: 60, x: 0, y: 0 } },
      });
    });
    const measuring = screen.getByTestId('navigation-bar-native-surface', {
      includeHiddenElements: true,
    });
    await act(async () =>
      measuring.props.onPageMetrics({
        nativeEvent: {
          revision: measuring.props.pageMetricsRequest.revision,
          widths: [48, 64, 88, 52],
          heights: [48, 48, 48, 48],
          width: 390,
        },
      }),
    );
    const toolbar = screen.getByTestId('navigation-bar-native-surface');
    expect(
      (toolbar.props.actions as Array<Record<string, unknown>>).every(
        action => !action.rootTab,
      ),
    ).toBe(true);
    expect(StyleSheet.flatten(toolbar.props.style)).toEqual(
      expect.objectContaining({ height: 48 }),
    );
    expect(toolbar.props.actions).toEqual([
      expect.objectContaining({ id: 'back', testID: 'calendar-back' }),
      expect.objectContaining({ id: 'home', testID: 'navigation-home' }),
    ]);
    const pageSurface = screen.getByTestId('navigation-page-action-surface');
    expect(pageSurface.props.actions).toEqual([
      expect.objectContaining({
        id: 'page:primary',
        testID: 'navigation-recording',
        systemImageName: 'mic',
        titleBelowImage: true,
      }),
    ]);

    await act(async () => {
      toolbar.props.onAction({ nativeEvent: { id: 'back' } });
      toolbar.props.onAction({ nativeEvent: { id: 'home' } });
      pageSurface.props.onAction({ nativeEvent: { id: 'page:primary' } });
    });
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onHome).toHaveBeenCalledTimes(1);
    expect(onPrimary).toHaveBeenCalledTimes(1);
    delete metricsControl.__OROT_TEST_PAGE_METRICS__;
  });
});
