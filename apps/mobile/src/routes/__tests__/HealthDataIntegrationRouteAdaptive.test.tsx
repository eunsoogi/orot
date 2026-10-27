import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import { AppRouteContent } from '../AppRouteContent';
import type { AppRouteContentProps } from '../AppProps';
import { appContentLayoutOwner } from '../../navigation/appContentLayoutPolicy';
import { createNavigationController } from '../../navigation/navigationController';
import type { NavigationRouteActions } from '../../navigation';
import type { NavigationGeometryPayload } from '../../navigation/navigationGeometry';
import { NavigationRouteAdapter } from '../../navigation/NavigationRouteAdapter';
import type { AppNavigationRoute } from '../appNavigationRoute';
import { expectDuoPanelsInsideNativeRegions } from '../testSupport/healthRecordsDuoLayoutAssertions';

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

jest.mock('../../layout/AppSymbol', () => ({ AppSymbol: () => null }));
jest.mock('../../healthkit/autoSyncLocal', () => ({
  configureLocalHealthKitAutoSync: jest.fn(async () => ({
    status: 'complete',
  })),
  loadLocalHealthKitAutoSyncSelection: jest.fn(async () => ['sleep']),
  loadLocalHealthKitAutoSyncStatus: jest.fn(async () => null),
}));
jest.mock('../../healthkit', () => ({
  healthKit: {
    getAvailability: jest.fn(async () => ({ status: 'available' })),
  },
}));

const originalWindow = Dimensions.get('window');
const originalScreen = Dimensions.get('screen');
const viewport = (width: number, fontScale = 1) => ({
  ...originalWindow,
  width,
  height: 700,
  scale: 1,
  fontScale,
});

beforeEach(() => {
  Dimensions.set({ window: viewport(390), screen: viewport(390) });
});

afterEach(() => {
  Dimensions.set({ window: originalWindow, screen: originalScreen });
});

function geometry(
  width: number,
  divisionX?: number,
): NavigationGeometryPayload {
  return {
    windowBounds: { x: 0, y: 0, width, height: 700 },
    safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    reservedRegionsSupported: divisionX !== undefined,
    reservedRegions:
      divisionX === undefined
        ? []
        : [
            {
              id: 'duo-division',
              kind: 'division',
              frame: { x: divisionX, y: 0, width: 10, height: 700 },
              margins: { top: 0, right: 0, bottom: 0, left: 0 },
              isActive: true,
            },
          ],
  };
}

function productionRouteProps(
  actions: NavigationRouteActions<AppNavigationRoute>,
): AppRouteContentProps {
  return {
    actions,
    activeTab: 'settings',
    selectTab: jest.fn(),
    appointmentRepository: null,
    backupPreparationState: 'checking',
    retryBackupPreparation: jest.fn(async () => undefined),
    appointmentState: 'ready',
    nextAppointment: null,
    recordings: [],
    recordingState: 'ready',
    refreshAppointments: jest.fn(async () => undefined),
    refreshRecordings: jest.fn(async () => undefined),
    calendarBridge: {} as AppRouteContentProps['calendarBridge'],
    calendarSync: {} as AppRouteContentProps['calendarSync'],
    selectedProvider: 'apple',
    onProviderSelectionCommitted: jest.fn(),
    openProviderSettings: jest.fn(),
    openVisitQuestions: jest.fn(),
    openDiseaseHypotheses: jest.fn(),
    openRagConversation: jest.fn(),
    openExternalEvidence: jest.fn(),
    openRecording: jest.fn(),
    loadHealthObservations: jest.fn(async () => ({
      records: [],
      nextCursor: null,
    })),
    loadHealthRecordMedications: jest.fn(async () => ({
      definitions: [],
      doseEvents: [],
    })),
    healthRecordDetailSelection: null,
    onHealthRecordDetailSelectionChange: jest.fn(),
  };
}

// Exercises AppRouteContent and SettingsDetailsRoute so the test covers the production wrapper path.
test('uses native usable regions and retains a category through compact, narrow, and large-text layouts', async () => {
  const route = { key: 'health-data', name: 'settings-health-data' };
  expect(
    typeof appContentLayoutOwner === 'function'
      ? appContentLayoutOwner(route)
      : appContentLayoutOwner,
  ).toBe('screen');

  const controller = createNavigationController<AppNavigationRoute>('home');
  const rootTabs = { activeTab: 'settings' as const, onSelect: jest.fn() };
  await render(
    <NavigationRouteAdapter
      contentLayoutOwner={appContentLayoutOwner}
      controller={controller}
      rootTabs={rootTabs}
    >
      {actions => <AppRouteContent {...productionRouteProps(actions)} />}
    </NavigationRouteAdapter>,
  );

  await fireEvent.press(screen.getByTestId('settings-open-health-data'));
  await screen.findByTestId('health-data-feature-status-sleep');
  expect(screen.getByTestId('health-data-title')).toBeTruthy();
  expect(screen.getByTestId('health-data-permission-status')).toHaveTextContent(
    /HealthKit 읽기 허용 여부는 앱에서 확인할 수 없어요\./,
  );
  const layout = screen.getByTestId('health-data-layout');
  const direction = () => StyleSheet.flatten(layout.props.style)?.flexDirection;
  const layoutStyle = () => StyleSheet.flatten(layout.props.style) ?? {};
  const primaryStyle = () =>
    StyleSheet.flatten(
      screen.getByTestId('health-data-layout-primary').props.style,
    ) ?? {};
  expect(direction()).toBe('column');

  const heartRate = screen.getByTestId('health-data-feature-heartRate');
  await fireEvent.press(heartRate);
  expect(
    screen.getByTestId('health-data-feature-status-heartRate'),
  ).toHaveTextContent('자동 동기화 켜짐');

  await act(async () => {
    Dimensions.set({ window: viewport(900), screen: viewport(900) });
    await fireEvent(
      screen.getByTestId('navigation-window-geometry-sensor'),
      'geometryChange',
      { nativeEvent: geometry(900, 445) },
    );
  });
  expect(direction()).toBe('row');
  expectDuoPanelsInsideNativeRegions('health-data-layout', geometry(900, 445));
  expect(
    screen.getByTestId('health-data-feature-status-heartRate'),
  ).toHaveTextContent('자동 동기화 켜짐');

  await fireEvent(
    screen.getByTestId('navigation-window-geometry-sensor'),
    'geometryChange',
    { nativeEvent: geometry(900, 620) },
  );
  expect(direction()).toBe('column');
  expect(primaryStyle().width).toBe(620);
  expect(layoutStyle().marginStart).toBe(0);
  expect(
    screen.getByTestId('health-data-feature-status-heartRate'),
  ).toHaveTextContent('자동 동기화 켜짐');

  const narrowRightRegion = geometry(900, 270);
  await act(async () => {
    await fireEvent(
      screen.getByTestId('navigation-window-geometry-sensor'),
      'geometryChange',
      { nativeEvent: narrowRightRegion },
    );
  });
  expect(direction()).toBe('column');
  expect(primaryStyle().width).toBe(620);
  expect(layoutStyle().width).toBe(620);
  expect(layoutStyle().marginStart).toBe(280);
  expect(
    screen.getByTestId('health-data-feature-status-heartRate'),
  ).toHaveTextContent('자동 동기화 켜짐');

  await act(async () => {
    Dimensions.set({ window: viewport(900, 2), screen: viewport(900, 2) });
    await fireEvent(
      screen.getByTestId('navigation-window-geometry-sensor'),
      'geometryChange',
      { nativeEvent: geometry(900, 445) },
    );
  });
  expect(direction()).toBe('column');
  expect(
    screen.getByTestId('health-data-feature-status-heartRate'),
  ).toHaveTextContent('자동 동기화 켜짐');
});
