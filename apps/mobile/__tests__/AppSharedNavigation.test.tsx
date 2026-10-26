import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { AlertButton } from 'react-native';
import type { ComponentProps } from 'react';
import App from '../App';
import { navigationText } from '../src/i18n/navigation';
import { createAppointmentStore } from '../test-helpers/appointmentStore';

jest.mock('../src/healthkit/autoSyncLocal', () => ({
  configureLocalHealthKitAutoSync: jest.fn(async () => ({
    status: 'complete',
    attemptedFeatures: [],
  })),
  loadLocalHealthKitAutoSyncSelection: jest.fn(async () => []),
  loadLocalHealthKitAutoSyncStatus: jest.fn(async () => null),
  syncLocalPreviouslyRequestedHealthKit: jest.fn(async () => ({
    status: 'skipped',
    attemptedFeatures: [],
  })),
}));
jest.mock('../src/backup/backupSupport', () => ({
  prepareBackupSupport: jest.fn(async () => 'ready'),
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

afterEach(() => jest.restoreAllMocks());

async function renderApp(props: ComponentProps<typeof App> = {}) {
  const store = createAppointmentStore();
  await render(
    <App
      loadAppointments={async () => store.repository}
      loadRecordings={async () => []}
      {...props}
    />,
  );
}

async function openRecords() {
  await fireEvent.press(screen.getByTestId('navigation-tab-records'));
  await waitFor(() => expect(screen.getByTestId('records-title')).toBeTruthy());
}

async function openSettings() {
  await fireEvent.press(screen.getByTestId('navigation-tab-settings'));
  await waitFor(() =>
    expect(screen.getByTestId('settings-title')).toBeTruthy(),
  );
}

// Recording and Settings routes publish leave permission after their state is ready.
async function waitForNavigationBackEnabled() {
  await waitFor(() =>
    expect(screen.getByTestId('navigation-back')).toBeEnabled(),
  );
}

test('routes recording from Records through the shared back button', async () => {
  await renderApp();

  await openRecords();
  await fireEvent.press(screen.getByTestId('records-new-recording'));
  expect(await screen.findByRole('header', { name: '상담 녹음' })).toBeTruthy();
  expect(screen.getByTestId('navigation-back')).toBeTruthy();
  expect(screen.queryByTestId('recording-back')).toBeNull();
  await waitForNavigationBackEnabled();
  await fireEvent.press(screen.getByTestId('navigation-back'));
  await waitFor(() => expect(screen.getByTestId('records-title')).toBeTruthy());
});

// Native-stack gesture removal is covered by NavigationRouteAdapterBackInputs.
test('uses shared unsaved-selection confirmation for the back button', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  await renderApp();

  await openSettings();
  await fireEvent.press(screen.getByTestId('settings-open-health-data'));
  expect(await screen.findByTestId('health-data-title')).toBeTruthy();
  expect(screen.getByTestId('navigation-back')).toBeTruthy();
  expect(screen.queryByTestId('health-data-back')).toBeNull();
  await waitForNavigationBackEnabled();
  const steps = await screen.findByTestId('health-data-feature-steps');
  await waitFor(() => expect(steps).toBeEnabled());
  await fireEvent.press(steps);

  await fireEvent.press(screen.getByTestId('navigation-back'));
  await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
  expect(alert.mock.calls[0]?.[0]).toBe(navigationText.leaveUnsaved.title);
  expect(alert.mock.calls[0]?.[1]).toBe(navigationText.leaveUnsaved.message);
  await pressAlertButton(alert, 0);
  expect(steps.props.accessibilityState.checked).toBe(true);

  await fireEvent.press(screen.getByTestId('navigation-back'));
  await waitFor(() => expect(alert).toHaveBeenCalledTimes(2));
  expect(alert.mock.calls[1]?.[0]).toBe(navigationText.leaveUnsaved.title);
  expect(alert.mock.calls[1]?.[1]).toBe(navigationText.leaveUnsaved.message);
  await pressAlertButton(alert, 1);
  await waitFor(() =>
    expect(screen.getByTestId('settings-title')).toBeTruthy(),
  );
});

test('routes imported health records through the shared back action', async () => {
  await renderApp();

  await openRecords();
  await fireEvent.press(screen.getByTestId('records-open-health-library'));
  expect(await screen.findByTestId('health-records-title')).toBeTruthy();
  expect(screen.getByTestId('navigation-back')).toBeTruthy();
  expect(screen.queryByTestId('health-records-back')).toBeNull();
  await waitForNavigationBackEnabled();
  await fireEvent.press(screen.getByTestId('navigation-back'));
  await waitFor(() => expect(screen.getByTestId('records-title')).toBeTruthy());
});

async function pressAlertButton(alert: jest.SpyInstance, index: number) {
  const buttons = alert.mock.calls.at(-1)?.[2] as AlertButton[] | undefined;
  const press = buttons?.[index]?.onPress;
  if (!press) throw new Error(`Alert button ${index} was not registered.`);
  await act(async () => {
    press();
    await Promise.resolve();
  });
}
