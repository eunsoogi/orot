import type { ReactNode } from 'react';
import { render } from '@testing-library/react-native';
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

test('uses nested content identity without changing the selected Records navigation tab', async () => {
  const controller = createNavigationController<'root'>('root');
  const content = (contentKey: 'records' | 'schedule') => (
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
    await view.rerender(content('schedule'));
    expect(timing).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ toValue: -12 }),
    );
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
