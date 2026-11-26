import {
  createAppointmentRepository,
  createRecordRepository,
  runMigrations,
} from '@orot/storage';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import App from '../App';
import { configureLocalHealthKitAutoSync } from '../src/healthkit/autoSyncLocal';
import { importLocalCommonObservations } from '../src/healthkit/commonObservations/importLocal';
import { createAppleSelectionOption } from '../src/providers/selection/options';
import * as classificationWorkflow from '../src/medicalAppointments/classificationWorkflow';
import { record } from '../src/medicalAppointments/testSupport/incrementalCalendarFixtures';
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

test('keeps imported records in Records and only reclassifies and reconfirms an edited Calendar occurrence', async () => {
  const opened = openSqliteTestDatabase(':memory:');

  try {
    await runMigrations(opened.database);
    const records = createRecordRepository(opened.database);
    const appointments = createAppointmentRepository(records, opened.database, {
      clock: () => '2035-06-01T00:00:00.000Z',
      createId: () => 'appointment-1',
    });
    const event = record(1);
    const { classificationWitness } = event;
    await appointments.confirmCalendarEvent(event);
    await appointments.classificationCache!.commit(
      0,
      [
        {
          ...classificationWitness,
          classification: 'medical',
          uncertainty: 'low',
        },
      ],
      undefined,
      new AbortController().signal,
    );
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
    let currentEvent: CalendarEvent = event;
    const listeners = new Set<() => void>();
    const listUpcomingEvents = jest.fn(async () => ({
      access: 'fullAccess' as const,
      events: [currentEvent],
    }));
    const requestEventAccess = jest.fn(async () => 'fullAccess' as const);
    const requestAccessAndListUpcomingEvents = jest.fn(async () => ({
      access: 'fullAccess' as const,
      events: [currentEvent],
    }));
    const calendar = {
      requestEventAccess,
      listUpcomingEvents,
      requestAccessAndListUpcomingEvents,
      findEvent: jest.fn(async () => ({
        access: 'fullAccess' as const,
        event: currentEvent,
      })),
      addEventStoreListener: jest.fn((listener: () => void) => {
        listeners.add(listener);
        return { remove: () => listeners.delete(listener) };
      }),
    } as unknown as EventKitCalendarBridge;
    const classify = jest
      .spyOn(classificationWorkflow, 'classifyCalendarEvents')
      .mockImplementation(async input => ({
        status: 'complete',
        candidates: [
          {
            candidateId: 'calendar-candidate-1',
            event: input.events[0]!,
            status: 'classified',
            classification: 'medical',
            reason: 'Synthetic classification result.',
            uncertainty: 'low',
          },
        ],
        completedBatches: 1,
        totalBatches: 1,
      }));
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

    await fireEvent.press(view.getByTestId('records-open-health-library'));
    const filter = await view.findByTestId('health-record-filter-heart_rate');
    await fireEvent.press(filter);
    expect(
      view.getByTestId('health-record-filter-heart_rate').props
        .accessibilityState?.selected,
    ).toBe(true);
    await fireEvent.press(
      view.getByTestId('health-records-open-health-import'),
    );
    expect(await view.findByTestId('health-data-title')).toBeTruthy();
    expect(view.queryByTestId('unified-import-start')).toBeNull();
    await fireEvent.press(view.getByTestId('navigation-back'));
    expect(
      (await view.findByTestId('health-record-filter-heart_rate')).props
        .accessibilityState?.selected,
    ).toBe(true);
    expect(view.queryByTestId('health-data-title')).toBeNull();

    await fireEvent.press(view.getByTestId('navigation-back'));
    await fireEvent.press(await view.findByTestId('navigation-tab-settings'));
    await fireEvent.press(await view.findByTestId('settings-open-health-data'));
    expect(await view.findByTestId('health-data-title')).toBeTruthy();
    await fireEvent.press(view.getByTestId('navigation-back'));
    expect(await view.findByTestId('settings-title')).toBeTruthy();
    expect(configureLocalHealthKitAutoSync).not.toHaveBeenCalled();
    expect(importLocalCommonObservations).not.toHaveBeenCalled();
    expect(requestEventAccess).not.toHaveBeenCalled();

    await fireEvent.press(view.getByTestId('navigation-tab-records'));
    await fireEvent.press(view.getByTestId('records-section-schedule'));
    await fireEvent.press(view.getByTestId('open-medical-appointments'));
    expect(
      await view.findByText(medicalAppointmentCopy.localNotice),
    ).toBeTruthy();
    expect(classify).not.toHaveBeenCalled();

    await fireEvent.press(view.getByTestId('medical-appointment-import'));
    expect(
      await view.findByText(/기존 분류 1건 재사용 · 새로 분류 0건/),
    ).toBeTruthy();
    expect(
      await view.findByText(/이미 저장된 일정 1건은 변경하지 않았어요\./),
    ).toBeTruthy();
    expect(classify).not.toHaveBeenCalled();
    expect(reconfirmCalendarEvent).not.toHaveBeenCalled();

    const edited: CalendarEvent = {
      ...event,
      effectiveAt: '2035-06-02T09:15:00.000Z',
      classificationWitness: {
        ...classificationWitness,
        revision: record(1, 2).classificationWitness.revision,
      },
    };
    currentEvent = edited;
    const reads = listUpcomingEvents.mock.calls.length;
    await act(async () => {
      for (const listener of listeners) listener();
    });
    await waitFor(() =>
      expect(listUpcomingEvents.mock.calls.length).toBeGreaterThan(reads),
    );
    await fireEvent.press(view.getByRole('button', { name: '다시 분류하기' }));
    await fireEvent.press(view.getByTestId('medical-appointment-import'));
    await waitFor(() =>
      expect(reconfirmCalendarEvent).toHaveBeenCalledWith(
        originalAppointment.id,
        edited,
      ),
    );
    expect(reconfirmCalendarEvent).toHaveBeenCalledTimes(1);
    expect(classify).toHaveBeenCalledTimes(1);
    expect(classify.mock.calls[0]?.[0].events).toEqual([edited]);

    const finalAppointments = await appointments.list();
    expect(finalAppointments).toHaveLength(1);
    expect(finalAppointments[0]?.id).toBe(originalAppointment.id);
    expect(confirmCalendarEvent).not.toHaveBeenCalled();
    expect(finalAppointments[0]?.effectiveAt).toBe(edited.effectiveAt);
    expect(requestEventAccess).not.toHaveBeenCalled();
    expect(requestAccessAndListUpcomingEvents).not.toHaveBeenCalled();
  } finally {
    opened.close();
  }
});
