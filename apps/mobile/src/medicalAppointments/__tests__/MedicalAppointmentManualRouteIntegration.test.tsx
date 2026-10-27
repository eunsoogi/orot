import { fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import type { ReactNode } from 'react';
import { createAppointmentStore } from '../../../test-helpers/appointmentStore';
import type { CalendarAutoSyncState } from '../../calendar/calendarAutoSync';
import type { CalendarBridge } from '../../calendar/types';
import { appContentLayoutOwner } from '../../navigation/appContentLayoutPolicy';
import { NavigationRouteAdapter } from '../../navigation/NavigationRouteAdapter';
import { createNavigationController } from '../../navigation/navigationController';
import type { NavigationGeometryPayload } from '../../navigation/navigationGeometry';
import MedicalAppointmentRoute from '../MedicalAppointmentRoute';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => true,
}));

jest.mock('react-native-safe-area-context', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const { View: NativeView } = jest.requireActual(
    'react-native',
  ) as typeof import('react-native');

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
    SafeAreaView: ({
      children,
      edges,
      style,
      testID,
    }: {
      children?: ReactNode;
      edges?: readonly string[];
      style?: StyleProp<ViewStyle>;
      testID?: string;
    }) =>
      React.createElement(
        NativeView,
        { accessibilityHint: edges?.join(','), style, testID },
        children,
      ),
  };
});

const noInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const dividedGeometry: NavigationGeometryPayload = {
  windowBounds: { x: 0, y: 0, width: 1080, height: 800 },
  safeAreaInsets: noInsets,
  reservedRegionsSupported: true,
  reservedRegions: [
    {
      id: 'display-division',
      kind: 'division',
      frame: { x: 500, y: 0, width: 20, height: 800 },
      margins: noInsets,
      isActive: true,
    },
    {
      id: 'navigation-rail',
      kind: 'occlusion',
      frame: { x: 1020, y: 0, width: 60, height: 800 },
      margins: noInsets,
      isActive: true,
    },
  ],
};
const narrowGeometry: NavigationGeometryPayload = {
  windowBounds: { x: 0, y: 0, width: 360, height: 800 },
  safeAreaInsets: noInsets,
  reservedRegionsSupported: true,
  reservedRegions: [],
};

const measurableView = View as unknown as {
  prototype: {
    measureInWindow: (
      callback: (x: number, y: number, width: number, height: number) => void,
    ) => void;
  };
};
let appointmentsHostWidth = 1020;

beforeEach(() => {
  appointmentsHostWidth = 1020;
  jest
    .spyOn(measurableView.prototype, 'measureInWindow')
    .mockImplementation(function (
      this: { readonly props: { readonly testID?: string } },
      callback,
    ) {
      if (this.props.testID === 'medical-appointment-status-columns-host') {
        callback(0, 0, 1020, 800);
      } else if (this.props.testID === 'appointments-columns-host') {
        callback(0, 0, appointmentsHostWidth, 800);
      }
    });
});

afterEach(() => jest.restoreAllMocks());

async function renderProductionManualRoute() {
  type RouteName = 'schedule' | 'medical-manual';
  const store = createAppointmentStore();
  const controller = createNavigationController<RouteName>('schedule');
  controller.push('medical-manual');
  const loadAppointments = jest.fn(async () => store.repository);

  // Keep the real app layout policy and route adapter around the manual screen.
  await render(
    <NavigationRouteAdapter
      controller={controller}
      contentLayoutOwner={appContentLayoutOwner}
    >
      {({ route }) =>
        route.name === 'medical-manual' ? (
          <MedicalAppointmentRoute
            bridge={{} as CalendarBridge}
            calendarSync={{} as CalendarAutoSyncState}
            manual
            onOpenManual={jest.fn()}
            onOpenCalendarSettings={jest.fn()}
            loadAppointments={loadAppointments}
          />
        ) : (
          <View testID="medical-appointment-schedule-route" />
        )
      }
    </NavigationRouteAdapter>,
  );

  await fireEvent(
    screen.getByTestId('navigation-window-geometry-sensor'),
    'geometryChange',
    { nativeEvent: dividedGeometry },
  );
  await screen.findByTestId('appointments-empty');
  return { controller, store };
}

async function enterDraft(clinicLabel: string) {
  await fireEvent.changeText(
    screen.getByTestId('appointment-clinic-input'),
    clinicLabel,
  );
  await fireEvent.changeText(
    screen.getByTestId('appointment-date-input'),
    '2035-06-02',
  );
  await fireEvent.changeText(
    screen.getByTestId('appointment-time-input'),
    '09:30',
  );
  await fireEvent.changeText(
    screen.getByTestId('appointment-note-input'),
    'Bring the test results.',
  );
}

test('keeps the production manual form within usable geometry and guards its draft across reflow', async () => {
  const { controller, store } = await renderProductionManualRoute();

  await fireEvent.press(screen.getByTestId('appointment-add'));
  await enterDraft('Synthetic clinic draft');

  const primaryPanel = () => screen.getByTestId('appointments-columns-primary');
  expect(StyleSheet.flatten(primaryPanel().props.style)?.width).toBe(500);

  appointmentsHostWidth = 360;
  await fireEvent(
    screen.getByTestId('navigation-window-geometry-sensor'),
    'geometryChange',
    { nativeEvent: narrowGeometry },
  );
  expect(
    StyleSheet.flatten(primaryPanel().props.style)?.width,
  ).toBeLessThanOrEqual(360);
  expect(screen.getByTestId('appointment-clinic-input')).toHaveDisplayValue(
    'Synthetic clinic draft',
  );
  expect(screen.getByTestId('appointment-date-input')).toHaveDisplayValue(
    '2035-06-02',
  );
  expect(screen.getByTestId('appointment-time-input')).toHaveDisplayValue(
    '09:30',
  );
  expect(screen.getByTestId('appointment-note-input')).toHaveDisplayValue(
    'Bring the test results.',
  );

  const alert = jest
    .spyOn(Alert, 'alert')
    .mockImplementation((_title, _message, buttons) =>
      buttons?.[0]?.onPress?.(),
    );
  await fireEvent.press(screen.getByTestId('navigation-back'));
  expect(alert).toHaveBeenCalled();
  expect(controller.getSnapshot().currentRoute.name).toBe('medical-manual');
  expect(screen.getByTestId('appointment-clinic-input')).toHaveDisplayValue(
    'Synthetic clinic draft',
  );

  await fireEvent.press(screen.getByTestId('appointment-form-cancel'));
  expect(store.getAppointments()).toHaveLength(0);
  await fireEvent.press(screen.getByTestId('appointment-add'));
  await enterDraft('Saved synthetic clinic');
  await fireEvent.press(screen.getByTestId('appointment-save'));
  await screen.findByTestId('appointment-select-manual-1');
  expect(store.getAppointments()[0]).toMatchObject({
    clinicLabel: 'Saved synthetic clinic',
    note: 'Bring the test results.',
  });

  await fireEvent.press(screen.getByTestId('appointment-edit-manual-1'));
  await fireEvent.changeText(
    screen.getByTestId('appointment-clinic-input'),
    'Edited synthetic clinic',
  );
  await fireEvent.press(screen.getByTestId('appointment-save'));
  expect(store.getAppointments()[0]).toMatchObject({
    clinicLabel: 'Edited synthetic clinic',
    note: 'Bring the test results.',
  });
});
