import { act, render, screen } from '@testing-library/react-native';
import { NavigationActionBar } from '../NavigationActionBar';
import { createNavigationController } from '../navigationController';
import {
  BOTTOM_NAVIGATION_ROOT_LAYOUT,
  NavigationRootLayoutContext,
  type NavigationRootLayout,
} from '../navigationRootLayout';

const right = {
  placement: 'right',
  reservedRightWidth: 84,
  contentWidth: 382,
  windowHeight: 678,
  railTopInset: 192,
  railBottomInset: 38,
  railRightInset: 12,
  systemBottomInset: 34,
} as const;

test('anchors the solitary native Back to the safe upper rail without bypassing its guard', async () => {
  const controller = createNavigationController<'root' | 'detail'>('root');
  controller.push('detail');
  const back = jest.spyOn(controller, 'requestBack');
  const page = (leaveDisabled: boolean) => (
    <NavigationRootLayoutContext.Provider value={right}>
      <NavigationActionBar
        controller={controller}
        leaveDisabled={leaveDisabled}
        routeKey="detail"
        safeAreaHandledByParent
      />
    </NavigationRootLayoutContext.Provider>
  );
  const { rerender } = await render(page(true));
  const rail = screen.getByTestId('navigation-right-rail');
  expect(rail.props.railBackTopInset).toBe(192);
  // The old group top is still sent as a local fallback, not confused with the safe edge.
  expect(rail.props.railTopInset).toBe(580);
  expect(rail.props.actions).toEqual([
    expect.objectContaining({
      id: 'back',
      testID: 'navigation-back',
      accessibilityLabel: '이전 화면으로 돌아가기',
      disabled: true,
    }),
  ]);
  await act(async () => rail.props.onAction({ nativeEvent: { id: 'back' } }));
  expect(back).not.toHaveBeenCalled();

  await rerender(page(false));
  expect(screen.getByTestId('navigation-right-rail')).toBe(rail);
  expect(rail.props.railBackTopInset).toBe(192);
  await act(async () => rail.props.onAction({ nativeEvent: { id: 'back' } }));
  expect(back).toHaveBeenCalledTimes(1);
});

test('allocates the page dock below pinned Back without moving left or bottom controls', async () => {
  const controller = createNavigationController<'root'>('root');
  const close = jest.fn();
  const save = jest.fn();
  const page = (layout: NavigationRootLayout) => (
    <NavigationRootLayoutContext.Provider value={layout}>
      <NavigationActionBar
        controller={controller}
        rootTabs={{ activeTab: 'records', onSelect: jest.fn() }}
        routeBackAction={{ onPress: close }}
        pageActions={[
          {
            id: 'record-save',
            label: 'Save',
            accessibilityLabel: 'Save',
            testID: 'save',
            onPress: save,
          },
        ]}
        safeAreaHandledByParent
      />
    </NavigationRootLayoutContext.Provider>
  );
  const { rerender } = await render(page(right));
  const rail = screen.getByTestId('navigation-right-rail');
  const dock = screen.getByTestId('navigation-page-action-surface');
  expect(rail.props.railBackTopInset).toBe(192);
  expect(dock.props.railBackTopInset).toBeUndefined();
  expect(dock.props.railTopInset).toBe(244);
  expect(dock.props.railAvailableHeight - dock.props.railBottomInset).toBe(304);
  expect(rail.props.actions.map((action: { id: string }) => action.id)).toEqual(
    ['back', 'tab-conversation', 'tab-overview', 'tab-records', 'tab-settings'],
  );
  expect(screen.getByTestId('navigation-tab-records')).toBeSelected();

  await act(async () => {
    dock.props.onAction({ nativeEvent: { id: 'page:record-save' } });
    rail.props.onAction({ nativeEvent: { id: 'back' } });
  });
  expect(save).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledTimes(1);

  await rerender(page({ ...right, railSide: 'left' }));
  expect(rail.props.layoutMode).toBe('left');
  expect(rail.props.railBackTopInset).toBeUndefined();
  expect(dock.props.railTopInset).toBe(192);

  await rerender(page(BOTTOM_NAVIGATION_ROOT_LAYOUT));
  expect(screen.queryByTestId('navigation-right-rail')).toBeNull();
  const bottom = screen.getByTestId('navigation-bar-native-surface');
  expect(bottom.props.layoutMode).toBe('bottom');
  expect(bottom.props.railBackTopInset).toBeUndefined();
});
