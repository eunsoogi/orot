import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Animated, View } from 'react-native';
import { StyleSheet } from 'react-native';
import type { ReactNode } from 'react';
import { NavigationActionBar } from '../NavigationActionBar';
import { NavigationMotionContext } from '../NavigationMotionContext';
import { createNavigationController } from '../navigationController';
import type { NavigationRootTabs } from '../rootTabs';

function FallbackSurface({
  children,
  testID,
}: {
  children: ReactNode;
  testID: string;
}) {
  return <View testID={testID}>{children}</View>;
}

test('renders five tabs and routes the selected destination', async () => {
  const controller = createNavigationController<'home' | 'records'>('home');
  const root = controller.getSnapshot().currentRoute;
  controller.registerLeaveGuard(root.key, async () => true);
  const onSelect = jest.fn();
  const rootTabs: NavigationRootTabs = { activeTab: 'home', onSelect };
  await render(
    <NavigationActionBar
      controller={controller}
      rootTabs={rootTabs}
      safeAreaHandledByParent
      surface={FallbackSurface}
    />,
  );

  for (const tab of ['home', 'records', 'schedule', 'ai', 'settings']) {
    expect(screen.getByTestId(`navigation-tab-${tab}`)).toBeVisible();
  }
  expect(
    screen.getByTestId('navigation-tab-home').props.accessibilityState,
  ).toEqual({ selected: true, disabled: false });
  expect(
    StyleSheet.flatten(screen.getByTestId('navigation-tab-home').props.style),
  ).toEqual(expect.objectContaining({ borderRadius: 26, minHeight: 52 }));
  expect(
    StyleSheet.flatten(
      screen.getByTestId('navigation-tab-records').props.style,
    ),
  ).toEqual(expect.objectContaining({ borderRadius: 26, minHeight: 52 }));
  expect(
    screen.getByTestId('navigation-tab-records').props.accessibilityState,
  ).toEqual({ selected: false, disabled: false });
  expect(
    screen.getByTestId('navigation-tab-home').props.accessibilityLabel,
  ).toBe('홈 탭');
  expect(screen.queryByTestId('navigation-back')).toBeNull();
  await fireEvent.press(screen.getByTestId('navigation-tab-records'));
  await waitFor(() => expect(onSelect).toHaveBeenCalledWith('records'));
});

test('keeps the current tab when its registered leave guard denies switching', async () => {
  const controller = createNavigationController<'home' | 'records'>('home');
  const root = controller.getSnapshot().currentRoute;
  const guard = jest.fn(async () => false);
  controller.registerLeaveGuard(root.key, guard);
  const onSelect = jest.fn();
  await render(
    <NavigationActionBar
      controller={controller}
      rootTabs={{ activeTab: 'home', onSelect }}
      safeAreaHandledByParent
      surface={FallbackSurface}
    />,
  );

  await fireEvent.press(screen.getByTestId('navigation-tab-records'));
  await waitFor(() => expect(guard).toHaveBeenCalledTimes(1));
  expect(onSelect).not.toHaveBeenCalled();
});

test('animates changed selections and settles immediately with Reduce Motion', async () => {
  const controller = createNavigationController<'home' | 'records'>('home');
  const onSelect = jest.fn();
  const timing = jest.spyOn(Animated, 'timing').mockReturnValue({
    start: jest.fn(),
    stop: jest.fn(),
    reset: jest.fn(),
  } as unknown as Animated.CompositeAnimation);
  const renderBar = (activeTab: 'home' | 'records', reduceMotion = false) => (
    <NavigationMotionContext.Provider value={reduceMotion}>
      <NavigationActionBar
        controller={controller}
        rootTabs={{ activeTab, onSelect }}
        safeAreaHandledByParent
        surface={FallbackSurface}
      />
    </NavigationMotionContext.Provider>
  );

  const view = await render(renderBar('home'));
  expect(timing).not.toHaveBeenCalled();

  await view.rerender(renderBar('records'));
  expect(timing).toHaveBeenCalledTimes(2);
  expect(timing).toHaveBeenNthCalledWith(
    1,
    expect.anything(),
    expect.objectContaining({
      toValue: 0,
      duration: 140,
      useNativeDriver: false,
    }),
  );
  expect(timing).toHaveBeenNthCalledWith(
    2,
    expect.anything(),
    expect.objectContaining({
      toValue: 1,
      duration: 140,
      useNativeDriver: false,
    }),
  );

  timing.mockClear();
  await view.rerender(renderBar('home', true));
  expect(timing).not.toHaveBeenCalled();
  expect(
    screen.getByTestId('navigation-tab-home').props.accessibilityState,
  ).toEqual({ selected: true, disabled: false });
});
