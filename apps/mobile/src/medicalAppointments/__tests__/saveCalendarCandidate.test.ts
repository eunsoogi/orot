import { createAppointment } from '@orot/domain';
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
