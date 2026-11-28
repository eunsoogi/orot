import ProviderSelectionScreen from '../../providers/selection/ProviderSelectionScreen';
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
  ['settings-health-data', false],
  ['settings-sync-status', false],
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
    // Account, backup, health-data, and sync-status screens measure their own panels.
    const sceneColumns = screen.queryByTestId(
      `navigation-route-columns-${routeKey}`,
    );
    expect(Boolean(sceneColumns)).toBe(sceneOwnsColumns);
  },
);

test.each(['settings-provider', 'settings-accounts'] as const)(
  '%s puts its shared large title inside the measured Settings lane',
  async presentation => {
    await render(
      <ProviderSelectionScreen
        presentation={presentation}
        screenTitle="Synthetic settings page"
        options={[]}
        requirements={{ inputTypes: ['text'] }}
        selectionStore={{
          load: async () => null,
          save: async () => undefined,
          clear: async () => undefined,
        }}
      />,
    );
    const lane = screen.getByTestId('settings-provider-columns-primary');
    expect(lane).toContainElement(screen.getByText('Synthetic settings page'));
    expect(screen.getByText('Synthetic settings page')).toHaveStyle({
      fontSize: 34,
      fontWeight: '700',
    });
    expect(
      screen.getByTestId(presentation + '-screen').props.contentContainerStyle,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          paddingLeft: 20,
          paddingTop: 24,
        }),
      ]),
    );
  },
);
