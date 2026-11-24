import { cancelAppointment, createAppointment } from '@orot/domain';
import type { Appointment } from '@orot/domain';
import type { CalendarBridge } from '../../calendar/types';
import { saveCalendarCandidate } from '../saveCalendarCandidate';
import {
  event,
  repository,
  result,
} from '../MedicalAppointmentClassificationScreenTestFixtures';

test('repeat imports reconfirm the same occurrence without creating another appointment', async () => {
  const occurrence = event('recurring', '치과 진료', '2035-06-02');
  const saved: Appointment[] = [];
  const appointments = repository(async input => {
    const appointment = createAppointment({
      ...input,
      id: 'saved-appointment',
      recordedAt: '2035-06-01T00:00:00.000Z',
      ingestedAt: '2035-06-01T00:00:00.000Z',
      provenance: { origin: 'user_reported', sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' },
    });
    saved.push(appointment);
    return appointment;
  });
  jest.mocked(appointments.list).mockImplementation(async () => saved);
  const bridge: CalendarBridge = {
    requestAccessAndListUpcomingEvents: jest.fn(),
    findEvent: jest.fn(async () => ({
      access: 'fullAccess' as const,
      event: occurrence,
    })),
    addEventStoreListener: jest.fn(),
  };
  const candidate = result([occurrence]).candidates[0]!;
  await expect(
    saveCalendarCandidate(candidate, appointments, bridge),
  ).resolves.toBe('saved');
  await expect(
    saveCalendarCandidate(candidate, appointments, bridge),
  ).resolves.toBe('saved');
  expect(appointments.confirmCalendarEvent).toHaveBeenCalledTimes(1);
  expect(appointments.reconfirmCalendarEvent).toHaveBeenCalledWith(
    'saved-appointment',
    occurrence,
  );
});

test.each(['cancelled', 'completed'] as const)(
  'reimport preserves a %s occurrence instead of creating another appointment',
  async status => {
    const occurrence = event('recurring', '치과 진료', '2035-06-02');
    const scheduled = createAppointment({
      ...occurrence,
      id: 'cancelled-appointment',
      recordedAt: '2035-06-01T00:00:00.000Z',
      ingestedAt: '2035-06-01T00:00:00.000Z',
      provenance: { origin: 'user_reported', sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' },
    });
    const cancelled =
      status === 'cancelled'
        ? cancelAppointment(scheduled, '2035-06-01T01:00:00.000Z')
        : { ...scheduled, status };
    const appointments = repository();
    jest.mocked(appointments.list).mockResolvedValue([cancelled]);
    const bridge: CalendarBridge = {
      requestAccessAndListUpcomingEvents: jest.fn(),
      findEvent: jest.fn(async () => ({
        access: 'fullAccess' as const,
        event: occurrence,
      })),
      addEventStoreListener: jest.fn(),
    };
    await expect(
      saveCalendarCandidate(
        result([occurrence]).candidates[0]!,
        appointments,
        bridge,
      ),
    ).resolves.toBe('preserved');
    expect(appointments.confirmCalendarEvent).not.toHaveBeenCalled();
    expect(appointments.reconfirmCalendarEvent).not.toHaveBeenCalled();
    expect(cancelled.status).toBe(status);
  },
);

test('a manually rescheduled linked occurrence is not reconfirmed by classification', async () => {
  const occurrence = event(
    'manual-reschedule',
    'Synthetic visit',
    '2035-06-02',
  );
  const original = createAppointment({
    ...occurrence,
    id: 'linked',
    recordedAt: '2035-06-01T00:00:00.000Z',
    ingestedAt: '2035-06-01T00:00:00.000Z',
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
  });
  const appointments = repository();
  jest.mocked(appointments.list).mockResolvedValue([
    {
      ...original,
      status: 'rescheduled',
      startTimeAuthority: 'manual',
      effectiveAt: '2035-06-02T04:00:00.000Z',
    },
  ]);
  const findEvent = jest.fn();
  const bridge: CalendarBridge = {
    findEvent,
    requestAccessAndListUpcomingEvents: jest.fn(),
    addEventStoreListener: jest.fn(),
  };
  await expect(
    saveCalendarCandidate(
      result([occurrence]).candidates[0]!,
      appointments,
      bridge,
    ),
  ).resolves.toBe('preserved');
  expect(appointments.reconfirmCalendarEvent).not.toHaveBeenCalled();
  expect(findEvent).not.toHaveBeenCalled();
});
