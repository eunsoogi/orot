import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Dimensions, Linking, StyleSheet, View } from 'react-native';
import { appContentLayoutOwner } from '../../navigation/appContentLayoutPolicy';
import { NavigationRouteAdapter } from '../../navigation/NavigationRouteAdapter';
import { createNavigationController } from '../../navigation/navigationController';
import type { NavigationGeometryPayload } from '../../navigation/navigationGeometry';
import { t } from '../../i18n';
import type { AppRouteContentProps } from '../AppProps';
import { AppRouteContent } from '../AppRouteContent';
import type { AppNavigationRoute } from '../appNavigationRoute';

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
      bottom: 0,
    }),
    useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0, bottom: 0 }),
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
  Dimensions.set({ window: viewport(390), screen: viewport(390) });
});

afterEach(() => {
  Dimensions.set({ window: originalWindow, screen: originalScreen });
  jest.restoreAllMocks();
});

function geometry(
  width: number,
  divider?: { readonly x: number; readonly width: number },
): NavigationGeometryPayload {
  return {
    windowBounds: { x: 0, y: 0, width, height: 600 },
    safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    reservedRegionsSupported: divider !== undefined,
    reservedRegions: divider
      ? [
          {
            id: 'duo-division',
            kind: 'division',
            frame: { x: divider.x, y: 0, width: divider.width, height: 600 },
            margins: { top: 0, right: 0, bottom: 0, left: 0 },
            isActive: true,
          },
        ]
      : [],
  };
}

const contentProps: Omit<
  AppRouteContentProps,
  'actions' | 'backupPreparationState'
> = {
  activeTab: 'settings',
  selectTab: jest.fn(),
  appointmentRepository: null,
  retryBackupPreparation: jest.fn(async () => {}),
  appointmentState: 'ready',
  nextAppointment: null,
  recordings: [],
  recordingState: 'ready',
  refreshAppointments: jest.fn(async () => {}),
  refreshRecordings: jest.fn(async () => {}),
  // These inert adapters are outside the Settings Backup route exercised here.
  calendarBridge: {} as AppRouteContentProps['calendarBridge'],
  calendarSync: {} as AppRouteContentProps['calendarSync'],
  selectedProvider: 'Apple Intelligence',
  onProviderSelectionCommitted: jest.fn(),
  openProviderSettings: jest.fn(),
  openVisitQuestions: jest.fn(),
  openDiseaseHypotheses: jest.fn(),
  openRagConversation: jest.fn(),
  openExternalEvidence: jest.fn(),
  openRecording: jest.fn(),
  loadHealthObservations:
    jest.fn() as unknown as AppRouteContentProps['loadHealthObservations'],
  loadHealthRecordMedications:
    jest.fn() as unknown as AppRouteContentProps['loadHealthRecordMedications'],
  healthRecordDetailSelection: null,
  onHealthRecordDetailSelectionChange: jest.fn(),
};

test('production backup route reflows by usable region and retains recovery actions and state', async () => {
  const controller = createNavigationController<AppNavigationRoute>('home');
  const retry = jest.fn(async () => {});
  let backupPreparationState: AppRouteContentProps['backupPreparationState'] =
    'checking';
  const rootTabs = { activeTab: 'settings' as const, onSelect: jest.fn() };
  const renderApplication = () => (
    <NavigationRouteAdapter
      contentLayoutOwner={appContentLayoutOwner}
      controller={controller}
      rootTabs={route => (route.name === 'home' ? rootTabs : undefined)}
    >
      {actions => (
        <AppRouteContent
          {...contentProps}
          actions={actions}
          backupPreparationState={backupPreparationState}
          retryBackupPreparation={retry}
        />
      )}
    </NavigationRouteAdapter>
  );

  const { rerender } = await render(renderApplication());
  await fireEvent.press(screen.getByTestId('settings-open-backup'));
  await waitFor(() => {
    expect(controller.getSnapshot().currentRoute.name).toBe('settings-backup');
  });

  const routeKey = controller.getSnapshot().currentRoute.key;
  expect(screen.getByTestId('settings-backup-title')).toBeTruthy();
  expect(
    screen.queryByTestId(`navigation-route-columns-${routeKey}`),
  ).toBeNull();
  expect(screen.getByTestId('settings-backup-status-panel')).toBeTruthy();
  expect(screen.getByTestId('settings-backup-recovery-panel')).toBeTruthy();
  expect(
    screen.getByTestId('settings-backup-recovery-state'),
  ).toHaveTextContent(t('backup.recoveryNotChecked'));
  expect(screen.getByTestId('backup-status-message')).toHaveTextContent(
    t('backup.status.checking'),
  );
  expect(
    screen.getByTestId('backup-prepare').props.accessibilityState?.disabled,
  ).toBe(true);
  await fireEvent.press(screen.getByTestId('backup-prepare'));
  expect(retry).not.toHaveBeenCalled();

  backupPreparationState = 'recoveryRequired';
  await act(async () => rerender(renderApplication()));
  expect(
    screen.getByTestId('backup-prepare').props.accessibilityState?.disabled,
  ).toBe(false);
  await fireEvent.press(screen.getByTestId('backup-prepare'));
  expect(retry).toHaveBeenCalledTimes(1);

  const openSettings = jest
    .spyOn(Linking, 'openSettings')
    .mockRejectedValue(new Error('Settings unavailable'));
  await fireEvent.press(screen.getByTestId('backup-open-system-settings'));
  expect(await screen.findByRole('alert')).toBeTruthy();

  const sensor = screen.getByTestId('navigation-window-geometry-sensor');
  const direction = () =>
    StyleSheet.flatten(screen.getByTestId('settings-backup-layout').props.style)
      ?.flexDirection;
  await act(async () => {
    Dimensions.set({ window: viewport(900), screen: viewport(900) });
    await fireEvent(sensor, 'geometryChange', {
      nativeEvent: geometry(900, { x: 445, width: 10 }),
    });
  });
  expect(direction()).toBe('column');
  for (const side of ['primary']) {
    expect(
      StyleSheet.flatten(
        screen.getByTestId(`settings-backup-layout-${side}`).props.style,
      )?.width,
    ).toBeGreaterThan(320);
  }
  expect(screen.queryByTestId('settings-backup-layout-secondary')).toBeNull();
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByTestId('backup-status-message')).toHaveTextContent(
    t('backup.status.recoveryRequired'),
  );

  await act(async () => {
    Dimensions.set({ window: viewport(620), screen: viewport(620) });
    await fireEvent(sensor, 'geometryChange', {
      nativeEvent: geometry(620, { x: 305, width: 10 }),
    });
  });
  expect(direction()).toBe('column');
  expect(await screen.findByRole('alert')).toBeTruthy();

  await act(async () => {
    Dimensions.set({
      window: viewport(900, 1.5),
      screen: viewport(900, 1.5),
    });
    await fireEvent(sensor, 'geometryChange', {
      nativeEvent: geometry(900),
    });
  });
  expect(direction()).toBe('column');
  expect(screen.getByTestId('backup-open-system-settings')).toBeTruthy();
  openSettings.mockRestore();
});
