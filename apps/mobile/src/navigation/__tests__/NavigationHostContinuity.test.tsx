import { act, render, screen } from '@testing-library/react-native';
import { NavigationActionBar } from '../NavigationActionBar';
import { createNavigationController } from '../navigationController';

test('retains the measured native host when only the selected tab changes', async () => {
  const control = globalThis as typeof globalThis & {
    __OROT_TEST_PAGE_METRICS__?: null;
  };
  control.__OROT_TEST_PAGE_METRICS__ = null;
  try {
    const controller = createNavigationController<'home'>('home');
    const onSelect = jest.fn();
    const view = await render(
      <NavigationActionBar
        controller={controller}
        safeAreaHandledByParent
        rootTabs={{ activeTab: 'settings', onSelect }}
      />,
    );
    const surface = screen.getByTestId('navigation-bar-native-surface', {
      includeHiddenElements: true,
    });
    await act(async () =>
      surface.props.onPageMetrics({
        nativeEvent: {
          revision: surface.props.pageMetricsRequest.revision,
          width: 374,
          widths: [44, 44, 44, 44, 44],
          heights: [60, 60, 60, 60, 60],
        },
      }),
    );
    const mounted = screen.getByTestId('navigation-bar-native-surface');
    await view.rerender(
      <NavigationActionBar
        controller={controller}
        safeAreaHandledByParent
        rootTabs={{ activeTab: 'records', onSelect }}
      />,
    );
    expect(screen.getByTestId('navigation-bar-native-surface')).toBe(mounted);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(
      screen.getByTestId('navigation-tab-records').props.accessibilityState
        .selected,
    ).toBe(true);
  } finally {
    delete control.__OROT_TEST_PAGE_METRICS__;
  }
});
