import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, View } from 'react-native';
import type { AppointmentRepository } from '@orot/storage';
import type { CalendarAutoSyncState } from '../../calendar/calendarAutoSync';
import type { CalendarBridge } from '../../calendar/types';
import { NavigationGeometryProvider } from '../../navigation/NavigationGeometryProvider';
import type { NavigationGeometryPayload } from '../../navigation/navigationGeometry';
import MedicalAppointmentRoute from '../MedicalAppointmentRoute';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => true,
}));

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

const measurableView = View as unknown as {
  prototype: {
    measureInWindow: (
      callback: (x: number, y: number, width: number, height: number) => void,
    ) => void;
  };
};

beforeEach(() => {
  jest
    .spyOn(measurableView.prototype, 'measureInWindow')
    .mockImplementation(function (
      this: { readonly props: { readonly testID?: string } },
      callback,
    ) {
      if (this.props.testID === 'medical-appointment-status-columns-host') {
        callback(0, 0, 1020, 800);
      }
    });
});

afterEach(() => jest.restoreAllMocks());

async function renderManualRoute(
  loadAppointments: () => Promise<AppointmentRepository>,
) {
  await render(
    <NavigationGeometryProvider>
      <MedicalAppointmentRoute
        bridge={{} as CalendarBridge}
        calendarSync={{} as CalendarAutoSyncState}
        manual
        onOpenManual={jest.fn()}
        onOpenCalendarSettings={jest.fn()}
        loadAppointments={loadAppointments}
      />
    </NavigationGeometryProvider>,
  );

  await fireEvent(
    screen.getByTestId('navigation-window-geometry-sensor'),
    'geometryChange',
    { nativeEvent: dividedGeometry },
  );
}

function expectStatusPanelToStayInOneUsableRegion() {
  const panel = screen.getByTestId(
    'medical-appointment-status-columns-primary',
  );
  expect(StyleSheet.flatten(panel.props.style)?.width).toBe(500);
}

test('keeps manual-route loading content inside one divided usable region', async () => {
  await renderManualRoute(() => new Promise<AppointmentRepository>(() => {}));

  expectStatusPanelToStayInOneUsableRegion();
});

test('keeps manual-route error content inside one divided usable region', async () => {
  await renderManualRoute(async () => {
    throw new Error('Appointment repository unavailable');
  });

  await screen.findByTestId('medical-appointments-retry');
  expectStatusPanelToStayInOneUsableRegion();
});
