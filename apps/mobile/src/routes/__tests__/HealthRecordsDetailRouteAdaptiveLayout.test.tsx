import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import { mapBloodPressureCorrelation } from '../../healthkit/bloodPressure/mapper';
import { correlation } from '../../healthkit/bloodPressure/testSupport';
import { HealthRecordsRoute } from '../HealthRecordsRoute';
import { appContentLayoutOwner } from '../../navigation/appContentLayoutPolicy';
import { createNavigationController } from '../../navigation/navigationController';
import type { NavigationGeometryPayload } from '../../navigation/navigationGeometry';
import { NavigationRouteAdapter } from '../../navigation/NavigationRouteAdapter';
import type { AppNavigationRoute } from '../appNavigationRoute';
import type { HealthRecordsDetailSelection } from '../../healthkit/healthRecordsLibraryModel';
import type { HealthObservationPageLoader } from '@orot/storage';
import { expectHealthRecordPageInsideNativeRegion } from '../testSupport/healthRecordsDuoLayoutAssertions';

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
// The detail screen uses its real Date constructor to calculate the month cutoff.
const healthRecordReferenceTime = '2035-06-15T12:00:00.000Z';
const viewport = (width: number, fontScale = 1) => ({
  ...originalWindow,
  width,
  height: 600,
  scale: 1,
  fontScale,
});

beforeEach(() => {
  Dimensions.set({ window: viewport(900), screen: viewport(900) });
});

afterEach(() => {
  Dimensions.set({ window: originalWindow, screen: originalScreen });
  jest.useRealTimers();
});

function geometry(width: number, divided: boolean): NavigationGeometryPayload {
  // Send the native event shape through the real geometry provider and route adapter.
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

// The real adapter and detail route expose an outer scene-width constraint.
test('gives the production health detail route the full lane for its panels', async () => {
  jest.useFakeTimers({ now: Date.parse(healthRecordReferenceTime) });
  const controller = createNavigationController<AppNavigationRoute>('home');
  const observations = mapBloodPressureCorrelation(
    correlation('detail-route-adaptive'),
    healthRecordReferenceTime,
  ).observations.map(item => ({
    ...item,
    effectiveAt: healthRecordReferenceTime,
  }));
  const loadObservations = jest.fn(async () => ({
    records: observations,
    nextCursor: null,
  }));
  const loadMedicationData = jest.fn(async () => ({
    definitions: [],
    doseEvents: [],
  }));
  const onSelectionChange = jest.fn();

  await render(
    <NavigationRouteAdapter
      contentLayoutOwner={appContentLayoutOwner}
      controller={controller}
    >
      {actions =>
        actions.route.name === 'health-records-detail' ? (
          <StatefulHealthRecordsRoute
            actions={actions}
            loadMedicationData={loadMedicationData}
            loadObservations={loadObservations}
            onSelectionChange={onSelectionChange}
          />
        ) : (
          <Text testID="home-route">Home</Text>
        )
      }
    </NavigationRouteAdapter>,
  );

  await act(async () => {
    controller.push('health-records-detail');
  });
  const routeKey = controller.getSnapshot().currentRoute.key;

  expect(await screen.findByTestId('health-record-row-0')).toBeTruthy();
  await fireEvent(
    screen.getByTestId('navigation-window-geometry-sensor'),
    'geometryChange',
    { nativeEvent: geometry(900, true) },
  );

  expect(
    screen.queryByTestId(`navigation-route-columns-${routeKey}`),
  ).toBeNull();
  const layout = () => screen.getByTestId('health-records-detail-layout');
  const direction = () =>
    StyleSheet.flatten(layout().props.style)?.flexDirection;
  expect(direction()).toBe('column');
  expectHealthRecordPageInsideNativeRegion(
    'health-records-detail-layout',
    geometry(900, true),
  );
  expect(StyleSheet.flatten(layout().props.style)?.width).toBeGreaterThan(800);
  expect(
    screen.getByTestId('health-record-period-month').props.accessibilityState,
  ).toMatchObject({ selected: true });

  await fireEvent.press(screen.getByTestId('health-record-period-year'));
  expect(onSelectionChange).toHaveBeenCalledWith({
    category: 'blood_pressure',
    period: 'year',
  });

  await act(async () => {
    Dimensions.set({ window: viewport(900, 1.5), screen: viewport(900, 1.5) });
    await fireEvent(
      screen.getByTestId('navigation-window-geometry-sensor'),
      'geometryChange',
      { nativeEvent: geometry(900, true) },
    );
  });
  expect(direction()).toBe('column');
  expect(
    screen.getByTestId('health-record-period-year').props.accessibilityState,
  ).toMatchObject({ selected: true });
  expect(
    screen.getByTestId('health-record-row-0-systolic').props.accessibilityLabel,
  ).toBe('수축기 120 mmHg');
  expect(
    screen.getByTestId('health-record-row-0-systolic-source'),
  ).toHaveTextContent('HealthKit · Blood pressure monitor');

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
    screen.getByTestId('health-record-period-year').props.accessibilityState,
  ).toMatchObject({ selected: true });
  expect(screen.getByTestId('health-record-row-0')).toBeTruthy();
});

function StatefulHealthRecordsRoute({
  actions,
  loadMedicationData,
  loadObservations,
  onSelectionChange,
}: {
  readonly actions: React.ComponentProps<typeof HealthRecordsRoute>['actions'];
  readonly loadMedicationData: React.ComponentProps<
    typeof HealthRecordsRoute
  >['loadMedicationData'];
  readonly loadObservations: HealthObservationPageLoader;
  readonly onSelectionChange: jest.Mock;
}) {
  const [selection, setSelection] = useState<HealthRecordsDetailSelection>({
    category: 'blood_pressure',
    period: 'month',
  });

  return (
    <HealthRecordsRoute
      actions={actions}
      loadMedicationData={loadMedicationData}
      loadObservations={loadObservations}
      onSelectionChange={next => {
        onSelectionChange(next);
        setSelection(next);
      }}
      route="health-records-detail"
      selection={selection}
    />
  );
}
