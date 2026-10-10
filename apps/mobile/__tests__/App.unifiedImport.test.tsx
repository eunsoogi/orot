import {
  createAppointmentRepository,
  createRecordRepository,
  runMigrations,
} from '@orot/storage';
import { fireEvent, render } from '@testing-library/react-native';
import { openSqliteTestDatabase } from '../../../packages/storage/__tests__/sqliteTestDatabase';
import type {
  CalendarEvent,
  EventKitCalendarBridge,
} from '../src/calendar/types';

// Other route adapters stay mocked while this test exercises unified import services.
jest.mock('../src/healthkit/commonObservations/importLocal', () => ({
  importLocalCommonObservations: jest.fn(),
}));
jest.mock('../src/healthkit/bloodPressure/importLocal', () => ({
  importLocalBloodPressure: jest.fn(),
  listLocalBloodPressureObservations: jest.fn(),
}));
jest.mock('../src/recording/recordingLibraryService', () => ({
  recordingLibraryService: { list: jest.fn(async () => []) },
}));
// The startup recovery flow is covered separately without loading native backup modules.
jest.mock('../src/backup/backupSupport', () => ({
  prepareBackupSupport: jest.fn(async () => 'ready'),
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

test('reconfirms a selected EventKit event after reopening the production route', async () => {
  // Synthetic provider data and an in-memory database exercise production storage without device data.
  const opened = openSqliteTestDatabase(':memory:');

  try {
    await runMigrations(opened.database);
    const records = createRecordRepository(opened.database);
    let appointmentId = 0;
    const appointments = createAppointmentRepository(records, opened.database, {
      clock: () => '2035-06-01T00:00:00.000Z',
      createId: () => `appointment-${++appointmentId}`,
    });
    const confirmCalendarEvent = jest.spyOn(
      appointments,
      'confirmCalendarEvent',
    );
    const reconfirmCalendarEvent = jest.spyOn(
      appointments,
      'reconfirmCalendarEvent',
    );
    const calendarEvent: CalendarEvent = {
      calendarEventIdentifier: 'synthetic-calendar-event',
      effectiveAt: '2035-06-02T00:00:00.000Z',
      endsAt: '2035-06-02T01:00:00.000Z',
      calendarEventSnapshot: {
        title: 'Synthetic appointment candidate',
        timeZoneIdentifier: 'Asia/Seoul',
        isAllDay: false,
        occurrenceDate: null,
        isDetached: false,
        recurrenceRules: [],
      },
    };
    const eventKitBridge = {
      requestEventAccess: jest.fn(async () => 'fullAccess' as const),
      listUpcomingEvents: jest.fn(async () => ({
        access: 'fullAccess' as const,
        events: [calendarEvent],
      })),
      requestAccessAndListUpcomingEvents: jest.fn(async () => ({
        access: 'fullAccess' as const,
        events: [calendarEvent],
      })),
      findEvent: jest.fn(async () => ({
        access: 'fullAccess' as const,
        event: calendarEvent,
      })),
      addEventStoreListener: jest.fn(() => ({ remove: jest.fn() })),
    } as unknown as EventKitCalendarBridge;
    const healthKit = {
      requestReadAuthorizations: jest.fn(),
      querySampleChanges: jest.fn(),
      queryMedicationDefinitions: jest.fn(),
    };
    const openLocalStorage = jest.fn(async () => records);
    const openLocalAppointmentRepository = jest.fn(async () => appointments);

    // The lazy production module resolves these adapters only when this route is opened.
    jest.doMock('../src/healthkit', () => ({ healthKit }));
    jest.doMock('../src/calendar/calendarBridge', () => ({
      eventKitCalendarBridge: eventKitBridge,
    }));
    jest.doMock('../src/storage/secureDatabase', () => ({
      openLocalStorage,
      openLocalAppointmentRepository,
    }));
    const App = require('../App').default as typeof import('../App').default;
    const view = await render(
      <App
        loadAppointments={async () => appointments}
        loadRecordings={async () => []}
      />,
    );
    await fireEvent.press(view.getByTestId('navigation-tab-records'));

    await fireEvent.press(view.getByTestId('records-health-import'));
    expect(
      view.getByRole('header', { name: '건강 기록 가져오기' }),
    ).toBeTruthy();
    expect(view.getByTestId('unified-import-scroll')).toBeVisible();
    expect(view.queryByTestId('safe-area-scroll')).toBeNull();
    expect(view.getByTestId('unified-import-toggle-eventKit')).toBeTruthy();

    await fireEvent.press(view.getByTestId('unified-import-toggle-eventKit'));
    await fireEvent.press(view.getByTestId('unified-import-start'));
    expect(
      await view.findByTestId('unified-import-eventkit-candidate-0'),
    ).toBeTruthy();
    expect(openLocalAppointmentRepository).not.toHaveBeenCalled();

    await fireEvent.press(view.getByTestId('unified-import-eventkit-select-0'));
    await fireEvent.press(view.getByTestId('unified-import-eventkit-confirm'));
    expect(
      await view.findByTestId('unified-import-eventkit-confirmed'),
    ).toBeTruthy();
    expect(openLocalAppointmentRepository).toHaveBeenCalledTimes(1);
    expect(confirmCalendarEvent).toHaveBeenCalledTimes(1);
    const firstSave = await appointments.list();
    expect(firstSave).toHaveLength(1);

    await fireEvent.press(view.getByTestId('navigation-back'));
    expect(view.getByTestId('records-title')).toBeTruthy();
    await fireEvent.press(view.getByTestId('records-health-import'));
    expect(view.getByTestId('unified-import-start')).toBeDisabled();
    expect(
      view.queryByTestId('unified-import-eventkit-candidate-0'),
    ).toBeNull();
    // Provider API counts do not infer OS prompts; reopening alone must not query either provider.
    expect(eventKitBridge.requestEventAccess).toHaveBeenCalledTimes(1);
    expect(eventKitBridge.listUpcomingEvents).toHaveBeenCalledTimes(1);

    await fireEvent.press(view.getByTestId('unified-import-toggle-eventKit'));
    await fireEvent.press(view.getByTestId('unified-import-start'));
    expect(
      await view.findByTestId('unified-import-eventkit-candidate-0'),
    ).toBeTruthy();
    await fireEvent.press(view.getByTestId('unified-import-eventkit-select-0'));
    await fireEvent.press(view.getByTestId('unified-import-eventkit-confirm'));
    expect(
      await view.findByTestId('unified-import-eventkit-confirmed'),
    ).toBeTruthy();

    const finalAppointments = await appointments.list();
    expect(finalAppointments).toHaveLength(1);
    expect(finalAppointments[0]?.id).toBe(firstSave[0]?.id);
    expect(confirmCalendarEvent).toHaveBeenCalledTimes(1);
    expect(reconfirmCalendarEvent).toHaveBeenCalledTimes(1);
    expect(openLocalAppointmentRepository).toHaveBeenCalledTimes(2);
    expect(openLocalStorage).not.toHaveBeenCalled();
    expect(healthKit.requestReadAuthorizations).not.toHaveBeenCalled();
    expect(healthKit.querySampleChanges).not.toHaveBeenCalled();
    expect(healthKit.queryMedicationDefinitions).not.toHaveBeenCalled();
    expect(eventKitBridge.requestEventAccess).toHaveBeenCalledTimes(2);
    expect(eventKitBridge.listUpcomingEvents).toHaveBeenCalledTimes(2);
  } finally {
    opened.close();
  }
});
