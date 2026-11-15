import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ActionSheetIOS, Dimensions } from 'react-native';
import { NavigationActionBar } from '../NavigationActionBar';
import { createNavigationController } from '../navigationController';
import { registerNavigationTestObserver } from '../navigationTestObservation';

const metricsControl = globalThis as typeof globalThis & {
  __OROT_TEST_PAGE_METRICS__?: null;
};

test('keeps the selected root tab direct when large text requires More without page actions', async () => {
  const originalWindow = Dimensions.get('window');
  const originalScreen = Dimensions.get('screen');
  Dimensions.set({
    window: { ...originalWindow, width: 390 },
    screen: { ...originalScreen, width: 390 },
  });
  metricsControl.__OROT_TEST_PAGE_METRICS__ = null;
  try {
    const controller = createNavigationController<'home'>('home');
    await render(
      <NavigationActionBar
        controller={controller}
        safeAreaHandledByParent
        rootTabs={{ activeTab: 'settings', onSelect: jest.fn() }}
      />,
    );
    expect(screen.getByRole('progressbar')).toBeTruthy();
    expect(screen.queryByTestId('navigation-bottom-single-row')).toBeNull();
    const surface = screen.getByTestId('navigation-bar-native-surface', {
      includeHiddenElements: true,
    });
    await act(async () =>
      surface.props.onPageMetrics({
        nativeEvent: {
          revision: surface.props.pageMetricsRequest.revision,
          width: 374,
          widths: [100, 100, 100, 100, 80],
          heights: [110, 110, 110, 110, 110],
        },
      }),
    );
    expect(
      screen.getByTestId('navigation-tab-settings').props.accessibilityState
        .selected,
    ).toBe(true);
    expect(screen.getByTestId('navigation-page-action-overflow')).toBeTruthy();
    expect(
      screen.getByTestId('navigation-bar-native-surface').props.bottomHeight,
    ).toBe(110);
  } finally {
    await act(async () =>
      Dimensions.set({ window: originalWindow, screen: originalScreen }),
    );
    delete metricsControl.__OROT_TEST_PAGE_METRICS__;
  }
});

test('keeps the selected root and primary page action direct while More dispatches guarded tabs', async () => {
  const observe = jest.fn();
  const stopObservation = registerNavigationTestObserver(observe);
  const originalWindow = Dimensions.get('window');
  const originalScreen = Dimensions.get('screen');
  Dimensions.set({
    window: { ...originalWindow, width: 390 },
    screen: { ...originalScreen, width: 390 },
  });
  metricsControl.__OROT_TEST_PAGE_METRICS__ = null;
  const show = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions');
  let choose: ((index: number) => void) | undefined;
  show.mockImplementation((_options, callback) => {
    choose = callback;
  });
  try {
    const onSelect = jest.fn();
    const retry = jest.fn();
    const controller = createNavigationController<'home'>('home');
    controller.registerLeaveGuard(
      controller.getSnapshot().currentRoute.key,
      async () => true,
    );
    await render(
      <NavigationActionBar
        controller={controller}
        safeAreaHandledByParent
        rootTabs={{ activeTab: 'settings', onSelect }}
        pageActions={[
          {
            id: 'retry',
            label: 'Retry schedule',
            accessibilityLabel: 'Retry schedule',
            testID: 'retry',
            systemImageName: 'arrow.clockwise',
            onPress: retry,
          },
        ]}
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
          widths: [80, 80, 80, 80, 88, 44],
          heights: [60, 60, 60, 60, 48, 60],
        },
      }),
    );
    expect(
      screen.getByTestId('navigation-tab-settings').props.accessibilityState
        .selected,
    ).toBe(true);
    expect(screen.getByTestId('retry')).toBeTruthy();
    await fireEvent.press(
      screen.getByTestId('navigation-page-action-overflow'),
    );
    expect(observe).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'menu-handler' }),
    );
    expect(observe).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'menu-show-request' }),
    );
    const options = show.mock.calls[0]![0].options;
    const records = options.indexOf('기록 탭');
    expect(records).toBeGreaterThanOrEqual(0);
    await act(async () => choose?.(records));
    expect(onSelect).toHaveBeenCalledWith('records');
  } finally {
    await act(async () =>
      Dimensions.set({ window: originalWindow, screen: originalScreen }),
    );
    show.mockRestore();
    stopObservation();
    delete metricsControl.__OROT_TEST_PAGE_METRICS__;
  }
});

test('keeps primary action direct and preserves disabled, busy and destructive menu state', async () => {
  const originalWindow = Dimensions.get('window');
  const originalScreen = Dimensions.get('screen');
  Dimensions.set({
    window: { ...originalWindow, width: 280 },
    screen: { ...originalScreen, width: 280 },
  });
  metricsControl.__OROT_TEST_PAGE_METRICS__ = null;
  const show = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions');
  const dismiss = jest
    .spyOn(ActionSheetIOS, 'dismissActionSheet')
    .mockImplementation(() => undefined);
  let choose: ((index: number) => void) | undefined;
  show.mockImplementation((_options, callback) => {
    choose = callback;
  });
  try {
    const save = jest.fn();
    const cancel = jest.fn();
    const controller = createNavigationController<'home' | 'details'>('home');
    controller.push('details');
    const actions = [
      {
        id: 'save',
        label: 'Save record',
        accessibilityLabel: 'Save record',
        testID: 'save',
        systemImageName: 'checkmark',
        onPress: save,
      },
      {
        id: 'cancel',
        label: 'Discard draft',
        accessibilityLabel: 'Discard draft',
        testID: 'cancel',
        systemImageName: 'xmark',
        disabled: true,
        busy: true,
        destructive: true,
        onPress: cancel,
      },
    ];
    const view = await render(
      <NavigationActionBar
        controller={controller}

        safeAreaHandledByParent
        routeKey="first"
        pageActions={actions}
      />,
    );
    const surface = screen.getByTestId('navigation-bar-native-surface', {
      includeHiddenElements: true,
    });
    await act(async () =>
      surface.props.onPageMetrics({
        nativeEvent: {
          revision: surface.props.pageMetricsRequest.revision,
          width: 264,
          widths: [48, 88, 88, 52],
          heights: [48, 48, 48, 48],
        },
      }),
    );
    expect(screen.getByTestId('save')).toBeTruthy();
    await fireEvent.press(
      screen.getByTestId('navigation-page-action-overflow'),
    );
    const options = show.mock.calls[0]![0];
    const index = options.options.indexOf('Discard draft (진행 중)');
    expect(index).toBeGreaterThanOrEqual(0);
    expect(options.disabledButtonIndices).toContain(index);
    expect(options.destructiveButtonIndex).toContain(index);
    await view.rerender(
      <NavigationActionBar
        controller={controller}

        safeAreaHandledByParent
        routeKey="second"
        pageActions={actions}
      />,
    );
    expect(dismiss).toHaveBeenCalled();
    await act(async () => choose?.(index));
    expect(cancel).not.toHaveBeenCalled();
  } finally {
    await act(async () =>
      Dimensions.set({ window: originalWindow, screen: originalScreen }),
    );
    show.mockRestore();
    dismiss.mockRestore();
    delete metricsControl.__OROT_TEST_PAGE_METRICS__;
  }
});
