import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { View } from 'react-native';
import type { ReactNode } from 'react';
import { NavigationActionBar } from '../NavigationActionBar';
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
