import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react-native';
import { Animated, Text } from 'react-native';
import { createNavigationController } from '../navigationController';
import { NavigationRouteAdapter } from '../NavigationRouteAdapter';
import { NavigationMotionContext } from '../NavigationMotionContext';
import { createNavigationRootTabs } from '../rootTabs';

jest.mock('react-native-safe-area-context', () => {
  const React = require('react') as typeof import('react');
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
    SafeAreaView: ({ children }: { children?: ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

test('switches hub panes without a root fade but still fades between distinct root tabs', async () => {
  const controller = createNavigationController<'root'>('root');
  const content = (contentKey: 'records' | 'schedule' | 'overview') => (
    <NavigationMotionContext.Provider value={false}>
      <NavigationRouteAdapter
        controller={controller}
        rootTabs={() => createNavigationRootTabs(contentKey, jest.fn())}
      >
        {() => <Text>{contentKey}</Text>}
      </NavigationRouteAdapter>
    </NavigationMotionContext.Provider>
  );
  const view = await render(content('records'));
  const timing = jest.spyOn(Animated, 'timing');
  try {
    const rootFade = () =>
      timing.mock.calls.filter(
        ([, config]) =>
          config.toValue === 1 &&
          config.duration === 100 &&
          config.useNativeDriver,
      );
    await view.rerender(content('schedule'));
    expect(rootFade()).toHaveLength(0);
    expect(screen.getByText('schedule')).toBeVisible();
    expect(screen.queryByText('records')).toBeNull();

    await view.rerender(content('records'));
    expect(rootFade()).toHaveLength(0);
    expect(screen.getByText('records')).toBeVisible();

    await view.rerender(content('overview'));
    expect(rootFade()).toHaveLength(1);
  } finally {
    timing.mockRestore();
  }
});

test('keeps Records selected for schedule content', () => {
  expect(createNavigationRootTabs('schedule', jest.fn())).toMatchObject({
    activeTab: 'records',
    contentKey: 'schedule',
  });
});
