import { fireEvent, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import type { NavigationGeometryPayload } from '../../navigation/navigationGeometry';
import {
  columnsAxis,
  noInsets,
  renderMedicalRoute,
  setWindowSize,
  windowBounds,
} from '../testSupport/MedicalAppointmentClassificationLayoutTestSupport';

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

test('uses native usable regions and retains expanded candidate details through reflow', async () => {
  await setWindowSize(390, 1);
  const controller = await renderMedicalRoute();
  const routeKey = controller.getSnapshot().currentRoute.key;
  expect(
    screen.queryByTestId(`navigation-route-columns-${routeKey}`),
  ).toBeNull();

  await fireEvent.press(
    screen.getByTestId('medical-appointment-details-calendar-candidate-1'),
  );
  expect(screen.getByText(/분류 근거: Synthetic classification/)).toBeTruthy();

  windowBounds.set('medical-appointment-columns-frame-host', {
    x: 24,
    width: 1400,
  });
  await fireEvent(
    screen.getByTestId('medical-appointment-columns-frame-host'),
    'layout',
    {
      nativeEvent: { layout: { x: 24, y: 0, width: 1400, height: 800 } },
    },
  );
  const expandedGeometry: NavigationGeometryPayload = {
    windowBounds: { x: 0, y: 0, width: 1700, height: 800 },
    safeAreaInsets: noInsets,
    reservedRegionsSupported: true,
    reservedRegions: [
      {
        id: 'division',
        kind: 'division',
        frame: { x: 700, y: 0, width: 20, height: 800 },
        margins: noInsets,
        isActive: true,
      },
      {
        id: 'right-rail',
        kind: 'occlusion',
        frame: { x: 1640, y: 0, width: 60, height: 800 },
        margins: noInsets,
        isActive: true,
      },
    ],
  };
  await fireEvent(
    screen.getByTestId('navigation-window-geometry-sensor'),
    'geometryChange',
    { nativeEvent: expandedGeometry },
  );

  expect(columnsAxis()).toBe('column');
  expect(
    screen.getByTestId('medical-appointment-details-calendar-candidate-1').props
      .accessibilityState.expanded,
  ).toBe(true);

  await setWindowSize(760, 1.5);
  windowBounds.set('medical-appointment-columns-frame-host', {
    x: 24,
    width: 760,
  });
  await fireEvent(
    screen.getByTestId('medical-appointment-columns-frame-host'),
    'layout',
    {
      nativeEvent: { layout: { x: 24, y: 0, width: 760, height: 800 } },
    },
  );
  const narrowGeometry: NavigationGeometryPayload = {
    windowBounds: { x: 0, y: 0, width: 800, height: 800 },
    safeAreaInsets: noInsets,
    reservedRegionsSupported: true,
    reservedRegions: [
      {
        id: 'division',
        kind: 'division',
        frame: { x: 380, y: 0, width: 20, height: 800 },
        margins: noInsets,
        isActive: true,
      },
    ],
  };
  await fireEvent(
    screen.getByTestId('navigation-window-geometry-sensor'),
    'geometryChange',
    { nativeEvent: narrowGeometry },
  );

  expect(columnsAxis()).toBe('column');
  expect(screen.getByText(/분류 근거: Synthetic classification/)).toBeTruthy();
  expect(
    screen.getByTestId('medical-appointment-details-calendar-candidate-1').props
      .accessibilityState.expanded,
  ).toBe(true);
});
