import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { AppointmentRepository } from '@orot/storage';
import type { ComponentProps } from 'react';
import App from '../App';
import type { CalendarBridge } from '../src/calendar/types';
import type { CommonObservationsImportResult } from '../src/healthkit/commonObservations/CommonObservationsImportScreen';
import type { CommonObservationFeature } from '../src/healthkit/commonObservations/types';
import { importLocalCommonObservations } from '../src/healthkit/commonObservations/importLocal';
import { createAppointmentStore } from '../test-helpers/appointmentStore';

jest.mock('../src/healthkit/commonObservations/importLocal', () => ({
  importLocalCommonObservations: jest.fn(),
}));
jest.mock('../src/healthkit/bloodPressure/importLocal', () => ({
  importLocalBloodPressure: jest.fn(),
  listLocalBloodPressureObservations: jest.fn(),
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
  expect(screen.getByTestId('calendar-connect')).toHaveTextContent(
    '캘린더 일정 불러오기',
  );
  expect(screen.getByTestId('schedule-open-appointments')).toBeTruthy();
  expect(bridge.requestAccessAndListUpcomingEvents).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByTestId('schedule-open-appointments'));
  expect(screen.getByRole('header', { name: '예약' })).toBeTruthy();
  expect(screen.queryByTestId('navigation-tab-schedule')).toBeNull();
  await fireEvent.press(screen.getByTestId('navigation-back'));
  expect(screen.getByTestId('calendar-title')).toHaveTextContent('일정');
});

test('opens provider settings from Settings and returns there on Back', async () => {
  await renderApp();

  await selectTab('settings');
  expect(screen.getByTestId('settings-title')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('settings-open-provider'));

  expect(
    await screen.findByRole('header', { name: 'AI 제공자와 모델' }),
  ).toBeTruthy();
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
  expect(screen.getByText(/녹음 전에/)).toBeTruthy();
  expect(screen.getByTestId('recording-start')).toBeDisabled();

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
  expect(await screen.findByTestId('calendar-connect')).toBeTruthy();
  expect(loadAppointments).toHaveBeenCalledTimes(2);
});

test('requires selection and an explicit import before reading common HealthKit types', async () => {
  const importHealthObservations = jest.fn().mockResolvedValue({
    status: 'complete',
    importedCount: 1,
    deletedCount: 0,
    unsupportedCount: 0,
  });
  await renderApp({ importHealthObservations });

  await selectTab('records');
  await fireEvent.press(screen.getByTestId('records-open-common-observations'));
  expect(
    screen.getByRole('header', { name: '건강 기록 가져오기' }),
  ).toBeTruthy();
  expect(screen.getByTestId('navigation-route-scroll')).toBeVisible();
  expect(screen.getByTestId('common-observations-import')).toBeDisabled();
  expect(importHealthObservations).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByTestId('common-observations-toggle-steps'));
  expect(importHealthObservations).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('common-observations-import'));

  expect(importHealthObservations).toHaveBeenCalledWith(['steps']);
  expect(
    await screen.findByText(
      '선택한 기록의 변경을 가져왔어요. 1개 저장, 0개 삭제, 0개 미지원',
    ),
  ).toBeTruthy();
  await fireEvent.press(screen.getByTestId('navigation-back'));
  await waitFor(() => expect(screen.getByTestId('records-title')).toBeTruthy());
});

test('calls the production importer only after explicit selection', async () => {
  jest.mocked(importLocalCommonObservations).mockResolvedValue({
    status: 'complete',
    readAuthorization: 'notObservable',
    importedCount: 1,
    deletedCount: 0,
    unsupportedCount: 0,
    cursorAdvanced: true,
  });
  await renderApp();

  await selectTab('records');
  await fireEvent.press(screen.getByTestId('records-open-common-observations'));
  await fireEvent.press(
    screen.getByTestId('common-observations-toggle-bodyMass'),
  );
  expect(importLocalCommonObservations).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('common-observations-import'));

  expect(await screen.findByText(/1개 저장/u)).toBeTruthy();
  expect(importLocalCommonObservations).toHaveBeenCalledWith(['bodyMass']);
});

test('allows Back and reopening while the first import is still pending', async () => {
  let finishFirst!: (result: CommonObservationsImportResult) => void;
  let finishSecond!: (result: CommonObservationsImportResult) => void;
  const firstImport = new Promise<CommonObservationsImportResult>(resolve => {
    finishFirst = resolve;
  });
  const secondImport = new Promise<CommonObservationsImportResult>(resolve => {
    finishSecond = resolve;
  });
  const importHealthObservations = jest
    .fn<
      Promise<CommonObservationsImportResult>,
      [readonly CommonObservationFeature[]]
    >()
    .mockReturnValueOnce(firstImport)
    .mockReturnValueOnce(secondImport);
  await renderApp({ importHealthObservations });

  await selectTab('records');
  await fireEvent.press(screen.getByTestId('records-open-common-observations'));
  await fireEvent.press(
    screen.getByTestId('common-observations-toggle-heartRate'),
  );
  await fireEvent.press(screen.getByTestId('common-observations-import'));
  expect(importHealthObservations).toHaveBeenCalledTimes(1);

  await fireEvent.press(screen.getByTestId('navigation-back'));
  await fireEvent.press(screen.getByTestId('records-open-common-observations'));
  await fireEvent.press(
    screen.getByTestId('common-observations-toggle-heartRate'),
  );
  await fireEvent.press(screen.getByTestId('common-observations-import'));
  expect(importHealthObservations).toHaveBeenCalledTimes(2);

  const result: CommonObservationsImportResult = {
    status: 'complete',
    importedCount: 1,
    deletedCount: 1,
    unsupportedCount: 0,
  };
  await act(async () => {
    finishFirst(result);
    finishSecond(result);
    await Promise.resolve();
  });
  expect(await screen.findByText(/1개 저장, 1개 삭제/u)).toBeTruthy();
});
