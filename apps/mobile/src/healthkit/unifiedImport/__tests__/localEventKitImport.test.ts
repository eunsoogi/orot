import type { Appointment } from '@orot/domain';
import type { AppointmentRepository } from '@orot/storage';
import type { CalendarEvent } from '../../../calendar/types';
import { eventKitCalendarBridge } from '../../../calendar/calendarBridge';
import {
  openLocalAppointmentRepository,
  openLocalStorage,
} from '../../../storage/secureDatabase';
import { unifiedHealthImportCoordinator } from '../localImport';

jest.mock('../../index', () => ({
  healthKit: { requestReadAuthorizations: jest.fn() },
}));
jest.mock('../featureImporter', () => ({
  createUnifiedFeatureImporter: jest.fn(() => jest.fn()),
}));
jest.mock('../../../calendar/calendarBridge', () => ({
  eventKitCalendarBridge: {
    requestEventAccess: jest.fn(),
    listUpcomingEvents: jest.fn(),
  },
}));
jest.mock('../../../storage/secureDatabase', () => ({
  openLocalAppointmentRepository: jest.fn(),
  openLocalStorage: jest.fn(),
}));

const event: CalendarEvent = {
  calendarEventIdentifier: 'eventkit-occurrence-1',
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

describe('local EventKit appointment import', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .mocked(eventKitCalendarBridge.requestEventAccess)
      .mockResolvedValue('fullAccess');
    jest.mocked(eventKitCalendarBridge.listUpcomingEvents).mockResolvedValue({
      access: 'fullAccess',
      events: [event],
    });
  });

  it('persists only a confirmed occurrence and reconnects it on re-entry', async () => {
    let savedAppointments: Appointment[] = [];
    const appointment = {
      id: 'appointment-1',
      status: 'scheduled',
      effectiveAt: event.effectiveAt,
      calendarEventIdentifier: event.calendarEventIdentifier,
      calendarEventSnapshot: event.calendarEventSnapshot,
    } as unknown as Appointment;
    const repository = {
      list: jest.fn(async () => savedAppointments),
      confirmCalendarEvent: jest.fn(async () => {
        savedAppointments = [appointment];
        return appointment;
      }),
      reconfirmCalendarEvent: jest.fn(async () => appointment),
    } as unknown as AppointmentRepository;
    jest.mocked(openLocalAppointmentRepository).mockResolvedValue(repository);

    const selection = { healthKitFeatures: [], eventKit: true } as const;
    const firstRun = unifiedHealthImportCoordinator.start(selection);
    const firstResult = await firstRun.result;
    expect(firstResult.progress.eventKit.candidates).toEqual([event]);
    expect(openLocalAppointmentRepository).not.toHaveBeenCalled();

    await firstRun.confirmCalendarEvent(event);
    const reopenedRun = unifiedHealthImportCoordinator.start(selection);
    await reopenedRun.result;
    await reopenedRun.confirmCalendarEvent(event);

    expect(openLocalAppointmentRepository).toHaveBeenCalledTimes(2);
    expect(repository.confirmCalendarEvent).toHaveBeenCalledTimes(1);
    expect(repository.reconfirmCalendarEvent).toHaveBeenCalledTimes(1);
    expect(openLocalStorage).not.toHaveBeenCalled();
  });

  it('keeps separate recurrence occurrences as distinct appointments', async () => {
    const nextOccurrence: CalendarEvent = {
      ...event,
      effectiveAt: '2035-06-09T00:00:00.000Z',
      endsAt: '2035-06-09T01:00:00.000Z',
      calendarEventSnapshot: {
        ...event.calendarEventSnapshot,
        occurrenceDate: '2035-06-09T00:00:00.000Z',
      },
    };
    jest.mocked(eventKitCalendarBridge.listUpcomingEvents).mockResolvedValue({
      access: 'fullAccess',
      events: [event, nextOccurrence],
    });
    let savedAppointments: Appointment[] = [];
    const repository = {
      list: jest.fn(async () => savedAppointments),
      confirmCalendarEvent: jest.fn(async (candidate: CalendarEvent) => {
        const appointment = {
          id: `appointment-${savedAppointments.length + 1}`,
          status: 'scheduled',
          effectiveAt: candidate.effectiveAt,
          calendarEventIdentifier: candidate.calendarEventIdentifier,
          calendarEventSnapshot: candidate.calendarEventSnapshot,
        } as unknown as Appointment;
        savedAppointments = [...savedAppointments, appointment];
        return appointment;
      }),
      reconfirmCalendarEvent: jest.fn(async () => savedAppointments[0]),
    } as unknown as AppointmentRepository;
    jest.mocked(openLocalAppointmentRepository).mockResolvedValue(repository);

    const selection = { healthKitFeatures: [], eventKit: true } as const;
    const firstRun = unifiedHealthImportCoordinator.start(selection);
    await firstRun.result;
    await firstRun.confirmCalendarEvent(event);
    const nextRun = unifiedHealthImportCoordinator.start(selection);
    await nextRun.result;
    await nextRun.confirmCalendarEvent(nextOccurrence);

    expect(repository.confirmCalendarEvent).toHaveBeenCalledTimes(2);
    expect(repository.reconfirmCalendarEvent).not.toHaveBeenCalled();
    expect(savedAppointments).toHaveLength(2);
  });

  it('serializes overlapping confirmations of the same occurrence across runs', async () => {
    let savedAppointments: Appointment[] = [];
    let releaseFirstRead: () => void = () => undefined;
    let signalFirstRead: () => void = () => undefined;
    const firstReadGate = new Promise<void>(resolve => {
      releaseFirstRead = resolve;
    });
    const firstReadStarted = new Promise<void>(resolve => {
      signalFirstRead = resolve;
    });
    const appointment = {
      id: 'appointment-concurrent-1',
      status: 'scheduled',
      effectiveAt: event.effectiveAt,
      calendarEventIdentifier: event.calendarEventIdentifier,
      calendarEventSnapshot: event.calendarEventSnapshot,
    } as unknown as Appointment;
    const list = jest.fn(async () => {
      const snapshot = [...savedAppointments];
      if (list.mock.calls.length === 1) {
        signalFirstRead();
        await firstReadGate;
      }
      return snapshot;
    });
    const repository = {
      list,
      confirmCalendarEvent: jest.fn(async () => {
        savedAppointments = [appointment];
        return appointment;
      }),
      reconfirmCalendarEvent: jest.fn(async () => appointment),
    } as unknown as AppointmentRepository;
    jest.mocked(openLocalAppointmentRepository).mockResolvedValue(repository);

    const selection = { healthKitFeatures: [], eventKit: true } as const;
    const firstRun = unifiedHealthImportCoordinator.start(selection);
    await firstRun.result;
    const reopenedRun = unifiedHealthImportCoordinator.start(selection);
    await reopenedRun.result;

    const firstConfirmation = firstRun.confirmCalendarEvent(event);
    const reopenedConfirmation = reopenedRun.confirmCalendarEvent(event);
    await firstReadStarted;
    // Hold the first empty read so both runs would otherwise observe it before either insert.
    releaseFirstRead();
    await Promise.all([firstConfirmation, reopenedConfirmation]);

    expect(list).toHaveBeenCalledTimes(2);
    expect(repository.confirmCalendarEvent).toHaveBeenCalledTimes(1);
    expect(repository.reconfirmCalendarEvent).toHaveBeenCalledTimes(1);
    expect(savedAppointments).toHaveLength(1);
  });
});
