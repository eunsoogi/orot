// Hermes must install the real agent polyfills before App imports LangGraph.
import '../src/agent/polyfills';
import 'react-native-get-random-values';
import { AppRegistry } from 'react-native';
import {
  createAppointment,
  updateAppointment,
  cancelAppointment,
} from '@orot/domain';
import type { Appointment, HealthObservation } from '@orot/domain';
import type {
  AppointmentRepository,
  CalendarAppointmentInput,
  ManualAppointmentInput,
  HealthObservationCursor,
  HealthObservationPage,
} from '@orot/storage';
import App from '../App';
import { name as appName } from '../app.json';
import type { CalendarBridge, CalendarEvent } from '../src/calendar/types';

const hourMs = 60 * 60 * 1000;
const dayMs = 24 * hourMs;
const fixtureNow = Date.now();
const nextMorning = new Date(fixtureNow + dayMs);
nextMorning.setUTCHours(0, 0, 0, 0);

// These are input examples only. Classification still needs the user's real selected model.
const calendarEvents: CalendarEvent[] = [
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

// This fixture returns its entire declared range; a missing query would deliberately look incomplete.
const query = {
  fromInclusive: new Date(fixtureNow).toISOString(),
  toExclusive: new Date(fixtureNow + 365 * dayMs).toISOString(),
  horizonYears: 1 as const,
  resultLimit: null,
  complete: true,
  omittedEventCount: 0,
};
const calendarBridge: CalendarBridge = {
  requestEventAccess: async () => 'fullAccess',
  listUpcomingEvents: async () => ({
    access: 'fullAccess',
    events: calendarEvents,
    query,
  }),
  requestAccessAndListUpcomingEvents: async () => ({
    access: 'fullAccess',
    events: calendarEvents,
    query,
  }),
  findEvent: async identifier => ({
    access: 'fullAccess',
    event:
      calendarEvents.find(
        event => event.calendarEventIdentifier === identifier,
      ) ?? null,
  }),
  addEventStoreListener: () => ({ remove: () => undefined }),
};

// Imports persist only for this JS session; this adapter never writes the user's database.
const appointments = new Map<string, Appointment>();
let appointmentSequence = 0;
function saveNewAppointment(
  input: ManualAppointmentInput | CalendarAppointmentInput,
) {
  const now = new Date().toISOString();
  const appointment = createAppointment({
    ...input,
    id: `synthetic-appointment-${++appointmentSequence}`,
    recordedAt: now,
    ingestedAt: now,
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
  });
  appointments.set(appointment.id, appointment);
  return appointment;
}

function requireAppointment(id: string): Appointment {
  const appointment = appointments.get(id);
  if (!appointment) throw new Error('Synthetic appointment not found.');
  return appointment;
}

const repository: AppointmentRepository = {
  list: async () => [...appointments.values()],
  create: async input => saveNewAppointment(input),
  confirmCalendarEvent: async input => saveNewAppointment(input),
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
const loadAppointments = async () => repository;

const healthRecordCount = 1503;
const pageSize = 50;
function observationAt(index: number): HealthObservation {
  const effectiveAt = new Date(fixtureNow - index * hourMs).toISOString();
  return {
    id: `synthetic-health-${String(index).padStart(4, '0')}`,
    effectiveAt,
    recordedAt: effectiveAt,
    ingestedAt: new Date(fixtureNow).toISOString(),
    provenance: {
      origin: 'imported',
      sourceRecordIds: [],
      source: {
        system: 'healthkit',
        sourceIdentifier: 'synthetic-ui-fixture',
      },
    },
    reviewState: { status: 'unreviewed' },
    observationKind: 'measurement',
    concept: 'heart_rate',
    value: { kind: 'quantity', amount: 60 + (index % 30), unit: 'count/min' },
  };
}

/** Fixture latency exercises leaving during reads; it is not a SQL or HealthKit measurement. */
async function loadHealthObservationPage(
  cursor: HealthObservationCursor | null,
): Promise<HealthObservationPage> {
  const start = cursor
    ? Number(cursor.id.slice('synthetic-health-'.length)) + 1
    : 0;
  if (!Number.isInteger(start) || start < 0 || start > healthRecordCount) {
    throw new Error('Invalid synthetic health cursor.');
  }
  await new Promise<void>(resolve => setTimeout(resolve, cursor ? 250 : 2000));
  const records = Array.from(
    { length: Math.min(pageSize, healthRecordCount - start) },
    (_, offset) => observationAt(start + offset),
  );
  const last = records[records.length - 1];
  return {
    records,
    nextCursor:
      start + records.length < healthRecordCount && last
        ? { id: last.id, effectiveAt: last.effectiveAt }
        : null,
  };
}

/** Uses production screens, native recording, provider selection and actual Apple availability. */
function PagedRecordsProbeEntry() {
  return (
    <App
      calendarBridge={calendarBridge}
      loadAppointments={loadAppointments}
      loadHealthObservationPage={loadHealthObservationPage}
    />
  );
}

AppRegistry.registerComponent(appName, () => PagedRecordsProbeEntry);
