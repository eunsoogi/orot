import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import { emptyCalendarAutoSyncState } from '../../calendar/calendarAutoSync';
import { AppRouteContent } from '../AppRouteContent';
import type { AppRouteContentProps } from '../AppProps';
import { appContentLayoutOwner } from '../../navigation/appContentLayoutPolicy';
import { NavigationRouteAdapter } from '../../navigation/NavigationRouteAdapter';
import { createNavigationController } from '../../navigation/navigationController';
import type { NavigationGeometryPayload } from '../../navigation/navigationGeometry';
import type { AppNavigationRoute } from '../appNavigationRoute';

jest.mock('../../healthkit/autoSyncLocal', () => ({
  loadLocalHealthKitAutoSyncSelection: jest.fn(async () => ['sleep']),
  loadLocalHealthKitAutoSyncStatus: jest.fn(async () => ({
    status: 'retryable',
    updatedAt: '2026-10-18T12:00:00.000Z',
  })),
  syncLocalPreviouslyRequestedHealthKit: jest.fn(async () => ({
    status: 'complete',
    attemptedFeatures: ['sleep'],
  })),
}));

const measurableView = View as unknown as {
  prototype: {
    measureInWindow: (
      callback: (x: number, y: number, width: number, height: number) => void,
    ) => void;
  };
};
const hostBounds = new Map<
  string,
  { readonly x: number; readonly width: number }
>();
jest
  .spyOn(measurableView.prototype, 'measureInWindow')
  .mockImplementation(function (
    this: { readonly props: { readonly testID?: string } },
    callback,
  ) {
    const bounds = hostBounds.get(this.props.testID ?? '');
    if (bounds) callback(bounds.x, 0, bounds.width, 600);
  });

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
const viewport = (width: number, fontScale = 1) => ({
  ...originalWindow,
  width,
  height: 600,
  scale: 1,
  fontScale,
});

beforeEach(() => {
  hostBounds.clear();
  Dimensions.set({ window: viewport(900), screen: viewport(900) });
});

afterEach(() => {
  Dimensions.set({ window: originalWindow, screen: originalScreen });
});

function geometry(width: number, divided: boolean): NavigationGeometryPayload {
  return {
    windowBounds: { x: 0, y: 0, width, height: 600 },
    safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    reservedRegionsSupported: divided,
    reservedRegions: divided
      ? [
          {
            id: 'duo-division',
            kind: 'division',
            frame: { x: width / 2 - 5, y: 0, width: 10, height: 600 },
            margins: { top: 0, right: 0, bottom: 0, left: 0 },
            isActive: true,
          },
        ]
      : [],
  };
}

function routeProps(): Omit<AppRouteContentProps, 'actions'> {
  return {
    activeTab: 'settings',
    selectTab: jest.fn(),
    appointmentRepository: null,
    backupPreparationState: 'checking',
    retryBackupPreparation: async () => undefined,
    appointmentState: 'ready',
    nextAppointment: null,
    recordings: [],
    recordingState: 'ready',
    refreshAppointments: async () => undefined,
    refreshRecordings: async () => undefined,
    calendarBridge: {
      requestAccessAndListUpcomingEvents: async () => ({
        access: 'notDetermined',
        events: [],
      }),
      findEvent: async () => ({ access: 'notDetermined', event: null }),
      addEventStoreListener: () => ({ remove: () => undefined }),
    },
    calendarSync: {
      ...emptyCalendarAutoSyncState,
      requestAccess: async () => null,
      refresh: async () => undefined,
    },
    selectedProvider: 'Synthetic provider',
    onProviderSelectionCommitted: jest.fn(),
    openProviderSettings: jest.fn(),
    openVisitQuestions: jest.fn(),
    openDiseaseHypotheses: jest.fn(),
    openRagConversation: jest.fn(),
    openExternalEvidence: jest.fn(),
    openRecording: jest.fn(),
    loadHealthObservations: async () => ({ records: [], nextCursor: null }),
    loadHealthRecordMedications: async () => ({
      definitions: [],
      doseEvents: [],
    }),
    healthRecordDetailSelection: null,
    onHealthRecordDetailSelectionChange: jest.fn(),
  };
}

// This follows the same app adapter, route policy, and AppRouteContent switch as production.
test('adapts the production Settings sync route to native usable regions and text scale', async () => {
  const controller = createNavigationController<AppNavigationRoute>('home');
  const rootTabs = { activeTab: 'settings' as const, onSelect: jest.fn() };
  const props = routeProps();
  const payload = geometry(900, true);

  await render(
    <NavigationRouteAdapter
      contentLayoutOwner={appContentLayoutOwner}
      controller={controller}
      rootTabs={route => (route.name === 'home' ? rootTabs : undefined)}
      scrollable={route => route.name === 'home'}
    >
      {actions => <AppRouteContent {...props} actions={actions} />}
    </NavigationRouteAdapter>,
  );
  await fireEvent.press(screen.getByTestId('settings-open-sync-status'));

  const routeKey = controller.getSnapshot().currentRoute.key;
  expect(
    await screen.findByTestId('settings-sync-status-message'),
  ).toHaveTextContent(
    '마지막 동기화 중 문제가 있었어요. 권한과 저장소 상태를 확인한 뒤 다시 시도해 주세요.',
  );
  expect(
    screen.queryByTestId(`navigation-route-columns-${routeKey}`),
  ).toBeNull();
  hostBounds.set('settings-sync-status-layout-host', { x: 0, width: 900 });
  await fireEvent(
    screen.getByTestId('navigation-window-geometry-sensor'),
    'geometryChange',
    { nativeEvent: payload },
  );

  const layout = () => screen.getByTestId('settings-sync-status-layout');
  const direction = () =>
    StyleSheet.flatten(layout().props.style)?.flexDirection;
  expect(direction()).toBe('column');
  expect(
    screen.queryByTestId('settings-sync-status-layout-secondary'),
  ).toBeNull();
  expect(
    StyleSheet.flatten(
      screen.getByTestId('settings-sync-status-layout-primary').props.style,
    )?.width,
  ).toBeLessThanOrEqual(445);
  expect(
    screen.getByTestId('settings-sync-retry').props.accessibilityState.disabled,
  ).toBe(false);

  await act(async () => {
    Dimensions.set({ window: viewport(900, 1.5), screen: viewport(900, 1.5) });
  });
  expect(direction()).toBe('column');
  expect(
    screen.getByTestId('settings-sync-selected-features'),
  ).toHaveTextContent('수면');

  const compact = geometry(500, false);
  hostBounds.set('settings-sync-status-layout-host', { x: 0, width: 500 });
  await act(async () => {
    Dimensions.set({ window: viewport(500), screen: viewport(500) });
    await fireEvent(
      screen.getByTestId('navigation-window-geometry-sensor'),
      'geometryChange',
      { nativeEvent: compact },
    );
  });
  expect(direction()).toBe('column');
  expect(screen.getByTestId('settings-sync-status-message')).toBeTruthy();
});
