import { SymptomEntrySchema } from '@orot/storage';
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import { NavigationRouteAdapter } from '../../navigation/NavigationRouteAdapter';
import { appContentLayoutOwner } from '../../navigation/appContentLayoutPolicy';
import { createNavigationController } from '../../navigation/navigationController';
import type { AppNavigationRoute } from '../../routes/appNavigationRoute';
import SymptomsScreen from '../SymptomsScreen';

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

const originalWindow = Dimensions.get('window');
const originalScreen = Dimensions.get('screen');
const viewport = (width: number, fontScale = 1) => ({
  ...originalWindow,
  width,
  height: 600,
  scale: 1,
  fontScale,
});
const recordedAt = '2026-05-01T12:00:00Z';
const entry = SymptomEntrySchema.parse({
  id: 'synthetic-layout-symptom',
  effectiveAt: '2026-04-20T08:30:00Z',
  recordedAt,
  ingestedAt: recordedAt,
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  description: 'Synthetic hand tingling',
  bodySite: 'left hand',
  severity: 5,
  status: 'active',
});

function geometry(width: number, divided: boolean) {
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

function expectFormInFullContentLane() {
  const lane = screen.getByTestId('symptoms-form-lane');
  expect(StyleSheet.flatten(lane.props.style)).toMatchObject({
    minWidth: 0,
    width: '100%',
  });
  expect(
    within(screen.getByTestId('symptoms-layout')).queryByTestId(
      'symptom-description',
    ),
  ).toBeNull();
}

beforeEach(() => {
  Dimensions.set({ window: viewport(900), screen: viewport(900) });
});

afterEach(() => {
  Dimensions.set({ window: originalWindow, screen: originalScreen });
});

test('the symptom route shares the full usable lane and keeps selection through reflow', async () => {
  const controller = createNavigationController<AppNavigationRoute>('symptoms');
  const onFilterChange = jest.fn();

  await render(
    <NavigationRouteAdapter
      contentLayoutOwner={appContentLayoutOwner}
      controller={controller}
    >
      {({ route }) =>
        route.name === 'symptoms' ? (
          <SymptomsScreen
            entries={[entry]}
            onBack={jest.fn()}
            onRetry={jest.fn()}
            onFilterChange={onFilterChange}
            onCreate={jest.fn()}
            onUpdate={jest.fn()}
            onResolve={jest.fn()}
          />
        ) : (
          <Text testID="other-route">Other route</Text>
        )
      }
    </NavigationRouteAdapter>,
  );
  const routeKey = controller.getSnapshot().currentRoute.key;

  // The screen must own native geometry instead of receiving a scene-sized lane.
  expect(
    screen.queryByTestId(`navigation-route-columns-${routeKey}`),
  ).toBeNull();
  await fireEvent.press(screen.getByTestId(`symptom-select-${entry.id}`));
  await fireEvent.press(screen.getByTestId('symptom-filter-active'));
  const sensor = screen.getByTestId('navigation-window-geometry-sensor');
  const layout = screen.getByTestId('symptoms-layout');
  const direction = () => StyleSheet.flatten(layout.props.style)?.flexDirection;
  const width = () => StyleSheet.flatten(layout.props.style)?.width;

  await fireEvent.press(screen.getByTestId(`symptom-edit-${entry.id}`));
  const editDescription = screen.getByTestId('symptom-description');
  await fireEvent.changeText(editDescription, 'Synthetic edit draft');
  await fireEvent(editDescription, 'focus', { nativeEvent: {} });
  expectFormInFullContentLane();

  await fireEvent(sensor, 'geometryChange', {
    nativeEvent: geometry(900, true),
  });
  expect(direction()).toBe('row');
  expect(width()).toBeGreaterThan(800);
  expect(
    StyleSheet.flatten(
      screen.getByTestId('symptoms-layout-primary').props.style,
    )?.width,
  ).toBeGreaterThan(320);
  expect(
    StyleSheet.flatten(
      screen.getByTestId('symptoms-layout-secondary').props.style,
    )?.width,
  ).toBeGreaterThan(320);
  expect(
    screen.getByTestId('symptom-filter-active').props.accessibilityState
      ?.selected,
  ).toBe(true);
  expect(
    screen.getByTestId('symptoms-selected-description').props.children,
  ).toBe(entry.description);
  expect(screen.getByTestId('symptom-description')).toHaveProp(
    'value',
    'Synthetic edit draft',
  );
  expectFormInFullContentLane();

  await act(async () => {
    Dimensions.set({ window: viewport(500), screen: viewport(500) });
    await fireEvent(sensor, 'geometryChange', {
      nativeEvent: geometry(500, false),
    });
  });
  expect(direction()).toBe('column');
  expect(
    screen.getByTestId('symptom-filter-active').props.accessibilityState
      ?.selected,
  ).toBe(true);
  expect(
    screen.getByTestId('symptoms-selected-description').props.children,
  ).toBe(entry.description);
  expect(screen.getByTestId('symptom-description')).toHaveProp(
    'value',
    'Synthetic edit draft',
  );
  expectFormInFullContentLane();

  await act(async () => {
    Dimensions.set({ window: viewport(900, 1.5), screen: viewport(900, 1.5) });
    await fireEvent(sensor, 'geometryChange', {
      nativeEvent: geometry(900, false),
    });
  });
  expect(direction()).toBe('column');
  expect(screen.getByTestId('symptoms-selected-summary')).toBeTruthy();
  expect(onFilterChange).toHaveBeenCalledWith({ status: 'active' });

  await fireEvent.press(screen.getByTestId('symptom-form-cancel'));
  await fireEvent.press(screen.getByTestId('symptom-add'));
  expectFormInFullContentLane();
  await fireEvent.changeText(
    screen.getByTestId('symptom-description'),
    'Synthetic create draft',
  );
  await fireEvent.press(screen.getByTestId('symptom-status-active'));
  await act(async () => {
    Dimensions.set({ window: viewport(500), screen: viewport(500) });
    await fireEvent(sensor, 'geometryChange', {
      nativeEvent: geometry(500, false),
    });
  });
  expect(screen.getByTestId('symptom-description')).toHaveProp(
    'value',
    'Synthetic create draft',
  );
  expect(
    screen.getByTestId('symptom-status-active').props.accessibilityState
      ?.selected,
  ).toBe(true);
  expectFormInFullContentLane();
});
