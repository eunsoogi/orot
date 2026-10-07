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
});
