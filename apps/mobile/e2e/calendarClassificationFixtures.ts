import {
  createAppointment,
  updateAppointment,
  cancelAppointment,
} from '@orot/domain';
import type { Appointment } from '@orot/domain';
import type {
  AppointmentRepository,
  CalendarAppointmentInput,
  ManualAppointmentInput,
} from '@orot/storage';
import type { CalendarBridge, CalendarEvent } from '../src/calendar/types';

/** Each fixture owns a synthetic Calendar range and session-only repository. It never reads EventKit or opens the user's database. */
export function createCalendarClassificationFixtures(fixtureNow = Date.now()) {
  const hourMs = 60 * 60 * 1000;
  const dayMs = 24 * hourMs;
  const nextMorning = new Date(fixtureNow + dayMs);
  nextMorning.setUTCHours(0, 0, 0, 0);
  const events: CalendarEvent[] = [
    { title: '내과 진료', day: 0 },
    { title: '팀 점심', day: 1 },
    { title: '방문 일정', day: 2 },
  ].map((example, index) => ({
    calendarEventIdentifier: `synthetic-calendar-${index}`,
    effectiveAt: new Date(
      nextMorning.getTime() + example.day * dayMs,
    ).toISOString(),
    endsAt: new Date(
      nextMorning.getTime() + example.day * dayMs + hourMs,
    ).toISOString(),
    calendarEventSnapshot: {
      title: example.title,
      timeZoneIdentifier: 'Asia/Seoul',
      isAllDay: false,
      occurrenceDate: null,
      isDetached: false,
      recurrenceRules: [],
    },
  }));
  // Preserve the complete one-year query; absence of this metadata deliberately means an incomplete Calendar scan.
  const query = {
    fromInclusive: new Date(fixtureNow).toISOString(),
    toExclusive: new Date(fixtureNow + 365 * dayMs).toISOString(),
    horizonYears: 1 as const,
    resultLimit: null,
    complete: true,
    omittedEventCount: 0,
  };
  const bridge: CalendarBridge = {
    requestEventAccess: async () => 'fullAccess',
    listUpcomingEvents: async () => ({ access: 'fullAccess', events, query }),
    requestAccessAndListUpcomingEvents: async () => ({
      access: 'fullAccess',
      events,
      query,
    }),
    findEvent: async identifier => ({
      access: 'fullAccess',
      event:
        events.find(event => event.calendarEventIdentifier === identifier) ??
        null,
    }),
    addEventStoreListener: () => ({ remove: () => undefined }),
  };
  const appointments = new Map<string, Appointment>();
  let sequence = 0;
  function saveNew(input: ManualAppointmentInput | CalendarAppointmentInput) {
    const now = new Date().toISOString();
    const appointment = createAppointment({
      ...input,
      id: `synthetic-appointment-${++sequence}`,
      recordedAt: now,
      ingestedAt: now,
      provenance: { origin: 'user_reported', sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' },
    });
    appointments.set(appointment.id, appointment);
    return appointment;
  }
  function requireAppointment(id: string) {
    const value = appointments.get(id);
    if (!value) throw new Error('Synthetic appointment not found.');
    return value;
  }
  const repository: AppointmentRepository = {
    list: async () => [...appointments.values()],
    create: async input => saveNew(input),
    confirmCalendarEvent: async input => saveNew(input),
    reconfirmCalendarEvent: async (id, input) => {
      const next = updateAppointment(
        requireAppointment(id),
        input,
        new Date().toISOString(),
      );
      appointments.set(id, next);
      return next;
    },
    update: async (id, changes) => {
      const next = updateAppointment(
        requireAppointment(id),
        changes,
        new Date().toISOString(),
      );
      appointments.set(id, next);
      return next;
    },
    cancel: async id => {
      const next = cancelAppointment(
        requireAppointment(id),
        new Date().toISOString(),
      );
      appointments.set(id, next);
      return next;
    },
  };
  return { events, bridge, repository };
}
