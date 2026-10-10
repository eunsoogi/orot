import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { AppointmentRepository } from '@orot/storage';
import App from '../App';
import type { CalendarBridge, CalendarEvent } from '../src/calendar/types';
import * as classificationWorkflow from '../src/medicalAppointments/classificationWorkflow';
import { medicalAppointmentCopy } from '../src/medicalAppointments/copy.ko';
import { createAppleSelectionOption } from '../src/providers/selection/options';
import type {
  ProviderSelection,
  ProviderSelectionStore,
} from '../src/providers/selection/types';

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

const appleOption = createAppleSelectionOption('available');

/** Covers the real App entry, saved-provider wiring, and manual recovery boundary. */
function repository(): AppointmentRepository {
  return {
    list: jest.fn(async () => []),
    create: jest.fn(),
    confirmCalendarEvent: jest.fn(),
    reconfirmCalendarEvent: jest.fn(),
    update: jest.fn(),
    cancel: jest.fn(),
  } as unknown as AppointmentRepository;
}

function selectionStore(
  load: () => Promise<ProviderSelection | null> = async () => ({
    providerId: appleOption.provider.id,
    modelId: appleOption.modelId,
  }),
): ProviderSelectionStore {
  return { load, save: jest.fn(), clear: jest.fn() };
}

function calendarEvent(): CalendarEvent {
  return {
    calendarEventIdentifier: 'event-1',
    effectiveAt: '2035-06-02T00:00:00.000Z',
    endsAt: '2035-06-02T01:00:00.000Z',
    calendarEventSnapshot: {
      title: '치과 검진',
      timeZoneIdentifier: 'Asia/Seoul',
      isAllDay: false,
      occurrenceDate: null,
      isDetached: false,
      recurrenceRules: [],
    },
  };
}

function calendarBridge(event: CalendarEvent): CalendarBridge {
  return {
    requestAccessAndListUpcomingEvents: jest.fn(async () => ({
      access: 'fullAccess' as const,
      events: [event],
    })),
    findEvent: jest.fn(async () => ({
      access: 'fullAccess' as const,
      event,
    })),
    addEventStoreListener: jest.fn(() => ({ remove: jest.fn() })),
  };
}

afterEach(() => jest.restoreAllMocks());

it('opens classification with the saved AI and reaches the separate manual page', async () => {
  const event = calendarEvent();
  const appointments = repository();
  const loadSelection = jest.fn(async () => ({
    providerId: appleOption.provider.id,
    modelId: appleOption.modelId,
  }));
  const store = selectionStore(loadSelection);
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
          reason: '진료 목적의 일정입니다.',
          uncertainty: 'low',
        },
      ],
      completedBatches: 1,
      totalBatches: 1,
    });
  await render(
    <App
      loadAppointments={async () => appointments}
      calendarBridge={calendarBridge(event)}
      aiFeatureServiceDependencies={{
        selectedAi: {
          selectionStore: store,
          loadAppleOption: async () => appleOption,
        },
      }}
    />,
  );

  await fireEvent.press(screen.getByTestId('open-medical-appointments'));
  expect(
    await screen.findByText(medicalAppointmentCopy.localNotice),
  ).toBeTruthy();
  await fireEvent.press(screen.getByText(medicalAppointmentCopy.loadCalendar));
  expect(await screen.findByText('치과 검진')).toBeTruthy();
  await fireEvent.press(screen.getByText(medicalAppointmentCopy.classify));

  await waitFor(() =>
    expect(classify).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: appleOption.provider,
        modelId: appleOption.modelId,
        recipient: '기기 안의 Apple Intelligence',
        remoteProcessing: false,
      }),
    ),
  );
  await fireEvent.press(screen.getByTestId('medical-appointment-manual'));
  expect(await screen.findByTestId('appointment-add')).toBeTruthy();
  expect(loadSelection).toHaveBeenCalledTimes(1);
});

it('keeps manual entry available while the saved AI lookup is pending', async () => {
  // A stalled provider/account lookup must not hold the local manual route hostage.
  let failSelection!: (error: Error) => void;
  const load = jest.fn(
    () =>
      new Promise<ProviderSelection | null>((_resolve, reject) => {
        failSelection = reject;
      }),
  );
  const store = selectionStore(load);
  const appointments = repository();
  await render(
    <App
      loadAppointments={async () => appointments}
      aiFeatureServiceDependencies={{
        selectedAi: {
          selectionStore: store,
          loadAppleOption: async () => appleOption,
        },
      }}
    />,
  );

  await fireEvent.press(screen.getByTestId('open-medical-appointments'));
  await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  await fireEvent.press(
    await screen.findByTestId('medical-appointment-manual'),
  );
  expect(await screen.findByTestId('appointment-add')).toBeTruthy();

  await act(async () => failSelection(new Error('AI selection unavailable')));
});

it('shows the manual fallback when the saved provider lookup fails', async () => {
  const store = selectionStore(async () => {
    throw new Error('Saved provider unavailable');
  });
  await render(
    <App
      loadAppointments={async () => repository()}
      aiFeatureServiceDependencies={{
        selectedAi: {
          selectionStore: store,
          loadAppleOption: async () => appleOption,
        },
      }}
    />,
  );

  await fireEvent.press(screen.getByTestId('open-medical-appointments'));
  expect(
    await screen.findByText(medicalAppointmentCopy.providerUnavailable),
  ).toBeTruthy();
  await fireEvent.press(screen.getByTestId('medical-appointment-manual'));
  expect(await screen.findByTestId('appointment-add')).toBeTruthy();
});
