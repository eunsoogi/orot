import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { AppointmentRepository } from '@orot/storage';
import type { ComponentProps } from 'react';
import App from '../App';
import { mapBloodPressureCorrelation } from '../src/healthkit/bloodPressure/mapper';
import { correlation } from '../src/healthkit/bloodPressure/testSupport';
import type { CalendarBridge } from '../src/calendar/types';
import {
  configureLocalHealthKitAutoSync,
  syncLocalPreviouslyRequestedHealthKit,
} from '../src/healthkit/autoSyncLocal';
import { createAppointmentStore } from '../test-helpers/appointmentStore';

jest.mock('../src/healthkit/autoSyncLocal', () => ({
  configureLocalHealthKitAutoSync: jest.fn(
    async (features: readonly string[]) => ({
      status: 'complete',
      attemptedFeatures: features,
    }),
  ),
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

function createCalendarBridge(): CalendarBridge {
  return {
    listUpcomingEvents: jest.fn(async () => ({
      access: 'fullAccess' as const,
      events: [],
    })),
    requestAccessAndListUpcomingEvents: jest.fn(async () => ({
      access: 'fullAccess' as const,
      events: [],
    })),
    findEvent: jest.fn(async () => ({
      access: 'fullAccess' as const,
      event: null,
    })),
    addEventStoreListener: jest.fn(() => ({ remove: jest.fn() })),
  };
}

async function renderApp(props: ComponentProps<typeof App> = {}) {
  const fallbackStore = createAppointmentStore();
  await render(
    <App
      loadAppointments={async () => fallbackStore.repository}
      loadRecordings={async () => []}
      {...props}
    />,
  );
}

async function selectTab(tab: string) {
  await fireEvent.press(screen.getByTestId(`navigation-tab-${tab}`));
  await waitFor(() =>
    expect(screen.getByTestId(`navigation-tab-${tab}`)).toBeVisible(),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('keeps Home compact and groups calendar and appointment management under Schedule', async () => {
  const store = createAppointmentStore();
  const bridge = createCalendarBridge();
  const loadAppointments = jest.fn(async () => store.repository);
  await renderApp({ loadAppointments, calendarBridge: bridge });

  expect(screen.getByTestId('welcome-title')).toHaveTextContent('오롯');
  expect(screen.getByText('오늘도 나를 위한 기록')).toBeTruthy();
  expect(screen.queryByTestId('ai-feature-visit-questions')).toBeNull();
  expect(screen.queryByTestId('settings-open-provider')).toBeNull();
  expect(
    screen.getByTestId('navigation-tab-home').props.accessibilityState,
  ).toEqual(expect.objectContaining({ selected: true }));
  await waitFor(() => expect(loadAppointments).toHaveBeenCalledTimes(1));

  await selectTab('schedule');
  expect(screen.getByTestId('calendar-title')).toHaveTextContent('일정');
  expect(screen.queryByTestId('calendar-connect')).toBeNull();
  expect(screen.getByTestId('schedule-open-appointments')).toBeTruthy();
  expect(screen.getByTestId('open-medical-appointments')).toHaveTextContent(
    /AI로 일정 분류/,
  );
  expect(bridge.requestAccessAndListUpcomingEvents).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByTestId('schedule-open-appointments'));
  expect(screen.getByRole('header', { name: '예약' })).toBeTruthy();
  expect(screen.queryByTestId('navigation-tab-schedule')).toBeNull();
  await fireEvent.press(screen.getByTestId('navigation-back'));
  expect(screen.getByTestId('calendar-title')).toHaveTextContent('일정');
});

test('refreshes authorized Calendar events at app startup without requesting access', async () => {
  const bridge = createCalendarBridge();
  await renderApp({ calendarBridge: bridge });

  await waitFor(() =>
    expect(bridge.listUpcomingEvents).toHaveBeenCalledTimes(1),
  );
  expect(bridge.requestAccessAndListUpcomingEvents).not.toHaveBeenCalled();
});

test('opens provider settings from Settings and returns there on Back', async () => {
  await renderApp();

  await selectTab('settings');
  expect(screen.getByTestId('settings-title')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('settings-open-provider'));

  expect(await screen.findByRole('header', { name: 'AI 선택' })).toBeTruthy();
  expect(screen.getByTestId('settings-provider-screen')).toBeTruthy();
  expect(screen.queryByTestId('chatgpt-account-action')).toBeNull();
  await fireEvent.press(screen.getByTestId('navigation-back'));
  await waitFor(() =>
    expect(screen.getByTestId('settings-title')).toBeTruthy(),
  );
  expect(screen.getByTestId('navigation-tab-settings')).toBeVisible();
});

test('keeps consent-gated recording reachable from Records', async () => {
  await renderApp();

  await selectTab('records');
  expect(screen.getByTestId('records-title')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('records-new-recording'));
  expect(await screen.findByRole('header', { name: '상담 녹음' })).toBeTruthy();
  expect(screen.getByTestId('navigation-keyboard-avoiding-root')).toBeVisible();
  expect(screen.getByTestId('navigation-back')).toBeVisible();
  expect(screen.queryByTestId('recording-back')).toBeNull();
  expect(screen.getByRole('checkbox')).toBeVisible();
  expect(screen.getByTestId('recording-microphone-control')).toBeDisabled();

  await fireEvent.press(screen.getByTestId('navigation-back'));
  await waitFor(() => expect(screen.getByTestId('records-title')).toBeTruthy());
});

test('recovers the Schedule root after appointment storage needs a retry', async () => {
  const store = createAppointmentStore();
  const loadAppointments = jest
    .fn<Promise<AppointmentRepository>, []>()
    .mockRejectedValueOnce(new Error('storage unavailable'))
    .mockResolvedValueOnce(store.repository);
  await renderApp({ loadAppointments, calendarBridge: createCalendarBridge() });

  await selectTab('schedule');
  expect(await screen.findByTestId('schedule-retry')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('schedule-retry'));
  expect(await screen.findByTestId('calendar-month-view')).toBeTruthy();
  expect(screen.queryByTestId('calendar-connect')).toBeNull();
  expect(loadAppointments).toHaveBeenCalledTimes(2);
});

test('keeps health sync setup in Settings and removes manual imports from Records', async () => {
  await renderApp();
  await waitFor(() =>
    expect(syncLocalPreviouslyRequestedHealthKit).toHaveBeenCalledTimes(1),
  );

  await selectTab('records');
  expect(screen.getByTestId('records-new-recording')).toBeTruthy();
  expect(screen.getByTestId('records-open-health-library')).toBeTruthy();
  expect(screen.queryByTestId('records-health-import')).toBeNull();
  expect(screen.queryByTestId('records-open-common-observations')).toBeNull();
  expect(screen.queryByTestId('records-open-blood-pressure')).toBeNull();

  await selectTab('settings');
  await fireEvent.press(screen.getByTestId('settings-open-health-data'));
  expect(await screen.findByTestId('health-data-title')).toBeTruthy();
  expect(configureLocalHealthKitAutoSync).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('health-data-feature-medications'));
  await fireEvent.press(
    screen.getByTestId('health-data-feature-bloodPressure'),
  );
  await fireEvent.press(screen.getByTestId('health-data-save'));

  await waitFor(() =>
    expect(configureLocalHealthKitAutoSync).toHaveBeenCalledWith([
      'medications',
      'bloodPressure',
    ]),
  );
  expect(await screen.findByTestId('health-data-status')).toHaveTextContent(
    '자동 동기화 설정을 저장했어요.',
  );
});

test('opens the chart overview and navigates to its period-filtered pressure rows', async () => {
  const observations = mapBloodPressureCorrelation(
    correlation('app-health-records'),
    '2026-10-05T10:00:00.000Z',
  ).observations;
  await renderApp({ loadHealthObservations: async () => observations });

  await selectTab('records');
  await fireEvent.press(screen.getByTestId('records-open-health-library'));
  expect(
    await screen.findByTestId('health-record-chart-blood_pressure'),
  ).toBeTruthy();
  await fireEvent.press(
    screen.getByTestId('health-record-open-detail-blood_pressure'),
  );
  expect(
    await screen.findByTestId('health-records-detail-title'),
  ).toHaveTextContent('혈압 기록 상세');
  expect(
    screen.getByTestId('health-record-row-0-systolic').props.accessibilityLabel,
  ).toBe('수축기 120 mmHg');
  expect(
    screen.getByTestId('health-record-row-0-diastolic').props
      .accessibilityLabel,
  ).toBe('이완기 80 mmHg');
});
