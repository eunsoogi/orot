import {
  createAppointmentRepository,
  createRecordRepository,
  runMigrations,
} from '@orot/storage';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import App from '../App';
import { createAppleSelectionOption } from '../src/providers/selection/options';
import * as classificationWorkflow from '../src/medicalAppointments/classificationWorkflow';
import { medicalAppointmentCopy } from '../src/medicalAppointments/copy.ko';
import type {
  CalendarEvent,
  EventKitCalendarBridge,
} from '../src/calendar/types';
import { openSqliteTestDatabase } from '../../../packages/storage/__tests__/sqliteTestDatabase';

jest.mock('../src/healthkit/autoSyncLocal', () => ({
  configureLocalHealthKitAutoSync: jest.fn(),
  loadLocalHealthKitAutoSyncSelection: jest.fn(async () => []),
  loadLocalHealthKitAutoSyncStatus: jest.fn(async () => null),
  syncLocalPreviouslyRequestedHealthKit: jest.fn(async () => ({
    status: 'skipped',
    attemptedFeatures: [],
  })),
}));
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
jest.mock('../src/backup/backupSupport', () => ({
  prepareBackupSupport: jest.fn(async () => 'ready'),
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

const appleOption = createAppleSelectionOption('available');

test('keeps imported records in Records and reclassifies a saved appointment only after an explicit action', async () => {
  const opened = openSqliteTestDatabase(':memory:');

  try {
    await runMigrations(opened.database);
    const records = createRecordRepository(opened.database);
    const appointments = createAppointmentRepository(records, opened.database, {
      clock: () => '2035-06-01T00:00:00.000Z',
      createId: () => 'appointment-1',
    });
    const event: CalendarEvent = {
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
    await appointments.confirmCalendarEvent(event);
    const originalAppointment = (await appointments.list())[0];
    if (!originalAppointment)
      throw new Error('Expected the saved appointment.');

    const confirmCalendarEvent = jest.spyOn(
      appointments,
      'confirmCalendarEvent',
    );
    const reconfirmCalendarEvent = jest.spyOn(
      appointments,
      'reconfirmCalendarEvent',
    );
    const listUpcomingEvents = jest.fn(async () => ({
      access: 'fullAccess' as const,
      events: [event],
    }));
    const requestEventAccess = jest.fn(async () => 'fullAccess' as const);
    const requestAccessAndListUpcomingEvents = jest.fn(async () => ({
      access: 'fullAccess' as const,
      events: [event],
    }));
    const calendar = {
      requestEventAccess,
      listUpcomingEvents,
      requestAccessAndListUpcomingEvents,
      findEvent: jest.fn(async () => ({
        access: 'fullAccess' as const,
        event,
      })),
      addEventStoreListener: jest.fn(() => ({ remove: jest.fn() })),
    } as unknown as EventKitCalendarBridge;
    const classify = jest
      .spyOn(classificationWorkflow, 'classifyCalendarEvents')
      .mockResolvedValue({
        status: 'complete',
        candidates: [
          {
            candidateId: 'calendar-candidate-1',
            event,
            status: 'classified',
            classification: 'medical',
            reason: 'Synthetic classification result.',
            uncertainty: 'low',
          },
        ],
        completedBatches: 1,
        totalBatches: 1,
      });
    const view = await render(
      <App
        calendarBridge={calendar}
        loadAppointments={async () => appointments}
        loadRecordings={async () => []}
        aiFeatureServiceDependencies={{
          selectedAi: {
            selectionStore: {
              load: async () => ({
                providerId: appleOption.provider.id,
                modelId: appleOption.modelId,
              }),
              save: jest.fn(),
              clear: jest.fn(),
            },
            loadAppleOption: async () => appleOption,
          },
        }}
      />,
    );

    await waitFor(() => expect(listUpcomingEvents).toHaveBeenCalledTimes(1));
    expect(classify).not.toHaveBeenCalled();
    expect(requestEventAccess).not.toHaveBeenCalled();
    expect(requestAccessAndListUpcomingEvents).not.toHaveBeenCalled();

    await fireEvent.press(view.getByTestId('navigation-tab-records'));
    expect(view.getByTestId('records-open-health-library')).toBeTruthy();
    expect(view.queryByTestId('records-health-import')).toBeNull();
    expect(view.queryByTestId('records-open-common-observations')).toBeNull();
    expect(view.queryByTestId('records-open-blood-pressure')).toBeNull();
    expect(view.queryByTestId('unified-import-start')).toBeNull();

    await fireEvent.press(view.getByTestId('navigation-tab-schedule'));
    await fireEvent.press(view.getByTestId('open-medical-appointments'));
    expect(
      await view.findByText(medicalAppointmentCopy.localNotice),
    ).toBeTruthy();
    expect(classify).not.toHaveBeenCalled();

    await fireEvent.press(view.getByText(medicalAppointmentCopy.loadCalendar));
    await waitFor(() => expect(classify).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(reconfirmCalendarEvent).toHaveBeenCalledWith(
        originalAppointment.id,
        event,
      ),
    );

    const finalAppointments = await appointments.list();
    expect(finalAppointments).toHaveLength(1);
    expect(finalAppointments[0]?.id).toBe(originalAppointment.id);
    expect(confirmCalendarEvent).not.toHaveBeenCalled();
    expect(listUpcomingEvents).toHaveBeenCalledTimes(1);
    expect(requestEventAccess).not.toHaveBeenCalled();
    expect(requestAccessAndListUpcomingEvents).not.toHaveBeenCalled();
  } finally {
    opened.close();
  }
});
