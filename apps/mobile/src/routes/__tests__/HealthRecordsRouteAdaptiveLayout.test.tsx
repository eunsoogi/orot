import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import { HealthRecordsRoute } from '../HealthRecordsRoute';
import { appContentLayoutOwner } from '../../navigation/appContentLayoutPolicy';
import { createNavigationController } from '../../navigation/navigationController';
import { NavigationRouteAdapter } from '../../navigation/NavigationRouteAdapter';
import type { AppNavigationRoute } from '../appNavigationRoute';
import type { NavigationGeometryPayload } from '../../navigation/navigationGeometry';

const measurableView = View as unknown as {
  prototype: {
    measureInWindow: (
      callback: (x: number, y: number, width: number, height: number) => void,
    ) => void;
  };
};
jest
  .spyOn(measurableView.prototype, 'measureInWindow')
  .mockImplementation(() => {});

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

const originalWindow = Dimensions.get('window');
const originalScreen = Dimensions.get('screen');
// Default text scale leaves enough width in each native region for both panels.
const viewport = (width: number) => ({
  ...originalWindow,
  width,
  height: 600,
  scale: 1,
  fontScale: 1,
});

beforeEach(() => {
  Dimensions.set({ window: viewport(900), screen: viewport(900) });
});

afterEach(() => {
  Dimensions.set({ window: originalWindow, screen: originalScreen });
});

function geometry(width: number, divided: boolean): NavigationGeometryPayload {
  // Keep the provider's native event shape so the production route resolves both regions.
  return {
    windowBounds: { x: 0, y: 0, width, height: 600 },
    safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    reservedRegionsSupported: divided,
    reservedRegions: divided
      ? [
          {
            id: 'duo-division',
            kind: 'division',
            frame: { x: 445, y: 0, width: 10, height: 600 },
            margins: { top: 0, right: 0, bottom: 0, left: 0 },
            isActive: true,
          },
        ]
      : [],
  };
}

test('renders the production health route across native regions and keeps its route guard', async () => {
  const controller = createNavigationController<AppNavigationRoute>('home');
  const loadMedicationData = jest.fn(async () => ({
    definitions: [],
    doseEvents: [],
  }));
  const loadObservations = jest.fn(async () => ({
    records: [],
    nextCursor: null,
  }));
  const onSelectionChange = jest.fn();

  await render(
    <NavigationRouteAdapter
      contentLayoutOwner={appContentLayoutOwner}
      controller={controller}
    >
      {actions =>
        actions.route.name === 'health-records' ? (
          <HealthRecordsRoute
            actions={actions}
            loadMedicationData={loadMedicationData}
            loadObservations={loadObservations}
            onSelectionChange={onSelectionChange}
            route="health-records"
            selection={null}
          />
        ) : (
          <Text testID="home-route">Home</Text>
        )
      }
    </NavigationRouteAdapter>,
  );
  await act(async () => {
    controller.push('health-records');
  });
  const routeKey = controller.getSnapshot().currentRoute.key;

  expect(screen.getByTestId('health-records-open-health-import')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('health-record-filter-heart_rate'));
  await fireEvent(
    screen.getByTestId('navigation-window-geometry-sensor'),
    'geometryChange',
    { nativeEvent: geometry(900, true) },
  );

  expect(
    screen.queryByTestId(`navigation-route-columns-${routeKey}`),
  ).toBeNull();
  const layout = screen.getByTestId('health-records-layout');
  const direction = () => StyleSheet.flatten(layout.props.style)?.flexDirection;
  expect(direction()).toBe('row');
  expect(StyleSheet.flatten(layout.props.style)?.width).toBeGreaterThan(800);
  expect(
    StyleSheet.flatten(
      screen.getByTestId('health-records-layout-primary').props.style,
    )?.width,
  ).toBeGreaterThan(320);
  expect(
    StyleSheet.flatten(
      screen.getByTestId('health-records-layout-secondary').props.style,
    )?.width,
  ).toBeGreaterThan(320);
  expect(
    screen.getByTestId('health-record-filter-heart_rate').props
      .accessibilityState?.selected,
  ).toBe(true);

  await fireEvent(
    screen.getByTestId('navigation-window-geometry-sensor'),
    'geometryChange',
    { nativeEvent: geometry(900, false) },
  );
  expect(direction()).toBe('row');

  await act(async () => {
    Dimensions.set({ window: viewport(500), screen: viewport(500) });
    await fireEvent(
      screen.getByTestId('navigation-window-geometry-sensor'),
      'geometryChange',
      { nativeEvent: geometry(500, false) },
    );
  });
  expect(direction()).toBe('column');
  expect(
    screen.getByTestId('health-record-filter-heart_rate').props
      .accessibilityState?.selected,
  ).toBe(true);

  let allowed = false;
  await act(async () => {
    allowed = await controller.requestBack();
  });
  expect(allowed).toBe(true);
  expect(controller.getSnapshot().currentRoute.name).toBe('home');
});
