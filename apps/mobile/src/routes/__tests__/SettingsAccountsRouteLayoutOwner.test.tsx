import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import type { ReactNode } from 'react';
import { NavigationRouteAdapter } from '../../navigation/NavigationRouteAdapter';
import { appContentLayoutOwner } from '../../navigation/appContentLayoutPolicy';
import { createNavigationController } from '../../navigation/navigationController';
import type { AppNavigationRoute } from '../appNavigationRoute';

jest.mock('react-native-safe-area-context', () => {
  const React = require('react') as typeof import('react');
  return {
    SafeAreaInsetsContext: React.createContext({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    }),
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
    SafeAreaProvider: ({ children }: { children?: ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    SafeAreaView: ({ children }: { children?: ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

test.each([
  ['settings-accounts', false],
  ['settings-backup', false],
  ['settings-health-data', false],
  ['settings-sync-status', true],
] as const)(
  '%s uses the expected measured-content owner',
  async (routeName, sceneOwnsColumns) => {
    const controller =
      createNavigationController<AppNavigationRoute>(routeName);
    const routeKey = controller.getSnapshot().currentRoute.key;

    await render(
      <NavigationRouteAdapter
        contentLayoutOwner={appContentLayoutOwner}
        controller={controller}
      >
        {({ route }) => (
          <Text testID="settings-route-content">{route.name}</Text>
        )}
      </NavigationRouteAdapter>,
    );

    expect(screen.getByTestId('settings-route-content').props.children).toBe(
      routeName,
    );
    // Account, backup, and health-data screens measure panels; sync status stays scene-owned.
    const sceneColumns = screen.queryByTestId(
      `navigation-route-columns-${routeKey}`,
    );
    expect(Boolean(sceneColumns)).toBe(sceneOwnsColumns);
  },
);
